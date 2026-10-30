/**
 * Adapter for a private, trusted PostgreSQL connection with a transaction(cb)
 * and parameterized query(sql, values). Never use from the browser. The adapter
 * expects read-committed transactions and schema 001. Not yet deployed.
 */
export function createPostgresRepository(db) {
  return {
    async listRecent(cursor = null) {
      const result = await db.query(`select o.id as cursor_id,
        to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time,
        o.reference, o.created_at, o.order_status, o.details,
        q.state as notification_state from rawaa_store.orders o
        left join rawaa_store.notification_outbox q on q.order_id = o.id
        where ($1::timestamptz is null or (o.created_at, o.id) < ($1::timestamptz, $2::uuid))
        order by o.created_at desc, o.id desc limit 51`, [cursor?.time ?? null, cursor?.id ?? null]);
      return result.rows;
    },
    async insertPending({ order, idempotencyKey }) {
      const payload = JSON.stringify(order);
      // Fingerprint the customer's intent, not prices that may have changed
      // between the first submission and a retry after a lost response.
      const intent = JSON.stringify({ name: order.name, phone: order.phone, address: order.address,
        entries: order.entries.map(({ id, qty }) => ({ id, qty })).sort((a, b) => a.id.localeCompare(b.id)),
        scent: order.scent, oil: order.oil, zone: order.zone, method: order.method });
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(intent));
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const id = crypto.randomUUID();
      const reference = `RAWAA-${crypto.randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
      return db.transaction(async tx => {
        const inserted = await tx.query(
          `insert into rawaa_store.orders (id, reference, idempotency_key, request_hash, details)
           values ($1, $2, $3, $4, $5::jsonb)
           on conflict (idempotency_key) do nothing returning reference`,
          [id, reference, idempotencyKey, hash, payload]
        );
        if (inserted.rows.length) {
          await tx.query('insert into rawaa_store.notification_outbox (order_id) values ($1)', [id]);
          return { reference, result: 'created' };
        }
        const existing = await tx.query('select reference, request_hash from rawaa_store.orders where idempotency_key = $1', [idempotencyKey]);
        // Reusing a key for a different request is a conflict, never another success.
        if (existing.rows.length !== 1) throw new Error('IDEMPOTENCY_LOOKUP_FAILED');
        if (existing.rows[0].request_hash !== hash) return { result: 'conflict' };
        return { reference: existing.rows[0].reference, result: 'existing' };
      });
    }
  };
}
