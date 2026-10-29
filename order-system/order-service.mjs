import { prepareOrder } from './order-core.mjs';

/**
 * Backend orchestration contract. Nothing here opens an HTTP endpoint or stores data.
 * repository.insertPending must atomically enforce idempotency and persist an outbox
 * in the same transaction. notificationRunner must claim an outbox job atomically.
 */
export async function submitOrder({ input, idempotencyKey, config, repository, notificationRunner }) {
  if (typeof idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  let order;
  try { order = prepareOrder(input, config); } catch { return { ok: false, code: 'INVALID_REQUEST' }; }
  let saved;
  try { saved = await repository.insertPending({ order, idempotencyKey }); }
  catch { return { ok: false, code: 'NOT_SAVED' }; }
  // Don't report success unless storage returned a valid durable order reference.
  if (!saved || typeof saved.reference !== 'string' || !/^RAWAA-[A-Z0-9]{6,30}$/.test(saved.reference) ||
      (saved.result !== 'created' && saved.result !== 'existing')) return { ok: false, code: 'NOT_SAVED' };
  // The durable outbox is authoritative. Failed sends are recoverable separately;
  // an ambiguous Telegram timeout is not considered delivery, and needs review.
  if (saved.result === 'created') {
    try { await notificationRunner.kick(saved.reference); } catch { /* pending outbox remains */ }
  }
  return { ok: true, reference: saved.reference, status: 'pending_review' };
}
