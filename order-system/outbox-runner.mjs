import { sendOrderAlert } from './telegram-notifier.mjs';

/** Trusted server only. A scheduler must call processNext and recoverExpired. */
export function createOutboxRunner({ db, token, chatId, fetchImpl }) {
  async function processNext(reference = null) {
    if (reference !== null && (typeof reference !== 'string' || !/^RAWAA-[A-Z0-9]{6,30}$/.test(reference))) throw new Error('INVALID_REFERENCE');
    const leaseId = crypto.randomUUID();
    // SKIP LOCKED is used only as a queue primitive; state is also checked on update.
    // The lease is committed before the external request starts.
    const claimed = await db.query(`
      with next as (
        select q.order_id from rawaa_store.notification_outbox q
        join rawaa_store.orders o on o.id = q.order_id
        where q.state = 'pending' and ($1::text is null or o.reference = $1)
        order by q.updated_at, q.order_id
        for update of q skip locked limit 1
      )
      update rawaa_store.notification_outbox q
      set state = 'sending', lease_id = $2, lease_until = now() + interval '60 seconds',
          attempts = attempts + 1, updated_at = now()
      from next, rawaa_store.orders o
      where q.order_id = next.order_id and o.id = q.order_id and q.state = 'pending'
      returning q.order_id, o.reference`, [reference, leaseId]);
    if (!claimed.rows.length) return { state: 'no_pending' };
    const item = claimed.rows[0];
    let result;
    try { result = await sendOrderAlert({ token, chatId, reference: item.reference, fetchImpl }); }
    catch { result = { ok: false, reason: 'delivery_unknown' }; }
    const state = result.ok ? 'sent' : result.reason === 'delivery_failed' || result.reason === 'not_configured' || result.reason === 'invalid_reference' ? 'failed' : 'unknown';
    const finished = await db.query(`update rawaa_store.notification_outbox
      set state = $1, lease_id = null, lease_until = null, updated_at = now()
      where order_id = $2 and state = 'sending' and lease_id = $3 returning state`, [state, item.order_id, leaseId]);
    // A recovery may have marked it unknown while the sender was stalled.
    return { state: finished.rows.length ? state : 'unknown' };
  }

  async function recoverExpired() {
    // A crash may occur after Telegram accepted the message. Never automatically
    // retry an expired lease: that could send a duplicate.
    const result = await db.query(`update rawaa_store.notification_outbox
      set state = 'unknown', lease_id = null, lease_until = null, updated_at = now()
      where state = 'sending' and lease_until < now() returning order_id`);
    return { count: result.rows.length };
  }
  return { processNext, recoverExpired, kick: processNext };
}
