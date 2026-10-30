import { formatOwnerAlert } from './order-core.mjs';

/** A single attempt only. Callers must persist delivery status separately. */
export async function sendOrderAlert({ token, chatId, reference, fetchImpl = fetch }) {
  if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) ||
      typeof chatId !== 'string' || !/^-?\d{1,20}$/.test(chatId)) return { ok: false, reason: 'not_configured' };
  let text;
  try { text = formatOwnerAlert(reference); } catch { return { ok: false, reason: 'invalid_reference' }; }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return { ok: false, reason: 'delivery_unknown' };
    const data = await res.json();
    if (data?.ok === false) return { ok: false, reason: 'delivery_failed' };
    if (data?.ok !== true || !Number.isSafeInteger(data.result?.message_id) ||
        String(data.result?.chat?.id) !== chatId) return { ok: false, reason: 'delivery_unknown' };
    return { ok: true };
  } catch {
    // Never return or log provider errors: their URL may contain the bot token.
    // Timeouts are ambiguous and must not be silently marked as delivered.
    return { ok: false, reason: 'delivery_unknown' };
  }
}
