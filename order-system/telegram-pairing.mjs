/** Owner-only pairing flow. Repository operations must be transactional and private. */
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function createTelegramPairing({ repository, fetchImpl = fetch, botToken, now = Date.now }) {
  const configured = typeof botToken === 'string' && /^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken) &&
    typeof repository?.create === 'function' && typeof repository?.findCurrent === 'function' && typeof repository?.consume === 'function';
  async function start() {
    if (!configured) return { ok: false, error: 'unavailable' };
    const id = crypto.randomUUID();
    const code = hex(crypto.getRandomValues(new Uint8Array(16)));
    const issuedAt = now(), expiresAt = issuedAt + 10 * 60 * 1000;
    try {
      await repository.create({ id, codeHash: await digest(code), issuedAt, expiresAt });
      // Deliver this only to the authenticated owner, never logs or chat with an agent.
      return { ok: true, id, message: `/pair ${code}`, expiresAt };
    } catch { return { ok: false, error: 'unavailable' }; }
  }
  async function finish() {
    if (!configured) return { ok: false, error: 'unavailable' };
    try {
      const record = await repository.findCurrent();
      if (!record || !validId(record.id) || record.consumed || now() >= record.expiresAt || now() < record.issuedAt) return { ok: false, error: 'invalid' };
      const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/getUpdates`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 100, timeout: 0 }),
        redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) return { ok: false, error: 'unavailable' };
      const data = await response.json();
      if (data?.ok !== true || !Array.isArray(data.result)) return { ok: false, error: 'unavailable' };
      const matches = new Set();
      for (const update of data.result) {
        const message = update?.message;
        if (typeof message?.text !== 'string' || !/^\/pair [0-9a-f]{32}$/.test(message.text) || message.chat?.type !== 'private' ||
            !Number.isSafeInteger(message.chat?.id) || message.chat.id <= 0 || message.from?.id !== message.chat.id ||
            !Number.isInteger(message.date) || message.date * 1000 < Math.floor(record.issuedAt / 1000) * 1000 ||
            message.date * 1000 >= record.expiresAt || message.date * 1000 > now() + 60000) continue;
        if (await digest(message.text.slice(6)) === record.codeHash) matches.add(String(message.chat.id));
      }
      if (matches.size !== 1) return { ok: false, error: matches.size ? 'ambiguous' : 'not_found' };
      // The storage adapter must re-check hash, expiration and unused state atomically.
      const consumed = await repository.consume({ id: record.id, codeHash: record.codeHash, chatId: [...matches][0], now: now() });
      return consumed === true ? { ok: true } : { ok: false, error: 'invalid' };
    } catch { return { ok: false, error: 'unavailable' }; }
  }
  return { start, finish };
}
