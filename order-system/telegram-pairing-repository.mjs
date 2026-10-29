/** Trusted DB adapter. A transaction must roll back all operations on failure. */
export function createTelegramPairingRepository(db) {
  return {
    async create({ id, codeHash, issuedAt, expiresAt }) {
      await db.query(`insert into rawaa_store.telegram_pairing_challenge
        (singleton, id, code_hash, issued_at, expires_at, consumed)
        values (true, $1, $2, $3::timestamptz, $4::timestamptz, false)
        on conflict (singleton) do update set id=excluded.id, code_hash=excluded.code_hash,
          issued_at=excluded.issued_at, expires_at=excluded.expires_at, consumed=false`,
      [id, codeHash, new Date(issuedAt).toISOString(), new Date(expiresAt).toISOString()]);
    },
    async findCurrent() {
      const result = await db.query(`select id from rawaa_store.telegram_pairing_challenge where singleton=true`);
      return result.rows[0]?.id ? this.find(result.rows[0].id) : null;
    },
    async find(id) {
      const result = await db.query(`select id, code_hash, issued_at, expires_at, consumed
        from rawaa_store.telegram_pairing_challenge where id=$1`, [id]);
      if (result.rows.length !== 1) return null;
      const row = result.rows[0];
      return { id: row.id, codeHash: row.code_hash, issuedAt: new Date(row.issued_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(), consumed: row.consumed };
    },
    async consume({ id, codeHash, chatId }) {
      return db.transaction(async tx => {
        // Database clock and the guarded UPDATE enforce single-use even under concurrency.
        const claim = await tx.query(`update rawaa_store.telegram_pairing_challenge set consumed=true
          where id=$1 and code_hash=$2 and consumed=false and issued_at <= now() and expires_at > now()
          returning id`, [id, codeHash]);
        if (claim.rows.length !== 1) return false;
        await tx.query(`insert into rawaa_store.telegram_recipient (singleton, chat_id, paired_at)
          values (true, $1::bigint, now()) on conflict (singleton) do update
          set chat_id=excluded.chat_id, paired_at=excluded.paired_at`, [chatId]);
        return true;
      });
    }
  };
}
