import { submitOrder } from './order-service.mjs';

/** Staged handler only. rateLimit must be distributed and use a trusted client identity. */
export function createOrderHandler({ origin, config, repository, notificationRunner, verifyChallenge, rateLimit }) {
  const validConfig = typeof origin === 'string' && /^https:\/\/[^/]+$/.test(origin) && config &&
    typeof repository?.insertPending === 'function' && typeof notificationRunner?.kick === 'function' &&
    typeof verifyChallenge === 'function' && typeof rateLimit === 'function';
  const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store, private',
    'x-content-type-options':'nosniff', 'vary':'Origin' };
  const respond = (status, body, allowed = false) => new Response(JSON.stringify(body), { status,
    headers: allowed ? { ...headers, 'access-control-allow-origin': origin } : headers });
  return async request => {
    if (!validConfig) return respond(503, { error:'unavailable' });
    if (request.headers.get('origin') !== origin) return respond(403, { error:'forbidden' });
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:{
      'access-control-allow-origin':origin, 'access-control-allow-methods':'POST, OPTIONS',
      'access-control-allow-headers':'content-type', 'cache-control':'no-store', 'vary':'Origin' } });
    if (request.method !== 'POST') return respond(405, { error:'method_not_allowed' }, true);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return respond(415, { error:'invalid_type' }, true);
    const declared = request.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > 4096)) return respond(413, { error:'too_large' }, true);
    let body;
    try {
      if (!request.body) throw new Error('empty');
      const reader = request.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4096) { await reader.cancel(); return respond(413, { error:'too_large' }, true); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      body = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes));
    } catch { return respond(400, { error:'invalid_request' }, true); }
    const key = body?.idempotencyKey;
    if (body?.consent !== true || typeof body.challengeToken !== 'string' || body.challengeToken.length < 1 || body.challengeToken.length > 2048 ||
        typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) || !body.order || typeof body.order !== 'object' || Array.isArray(body.order)) {
      return respond(400, { error:'invalid_request' }, true);
    }
    try {
      const limit = await rateLimit(request);
      if (limit === false) return respond(429, { error:'try_later' }, true);
      if (limit !== true) return respond(503, { error:'unavailable' }, true);
      if (await verifyChallenge(body.challengeToken) !== true) return respond(403, { error:'challenge_failed' }, true);
    } catch { return respond(503, { error:'unavailable' }, true); }
    const result = await submitOrder({ input:body.order, idempotencyKey:key, config, repository, notificationRunner });
    if (!result.ok) {
      if (result.code === 'INVALID_REQUEST') return respond(400, {error:'invalid_request'}, true);
      if (result.code === 'INTENT_MISMATCH') return respond(409, {error:'intent_mismatch'}, true);
      return respond(503, {error:'save_uncertain'}, true);
    }
    return respond(200, { reference:result.reference, status:'pending_review' }, true);
  };
}

/** Cloudflare validation must run on the server, against a pinned hostname and action.
 * False is reserved for a verified token rejection; service/configuration failures
 * throw a generic error so the handler returns 503 rather than blaming the customer.
 */
export function createTurnstileVerifier({ secret, hostname, fetchImpl = fetch }) {
  if (typeof secret !== 'string' || !secret || typeof hostname !== 'string' || !/^[a-z0-9.-]+$/.test(hostname) || typeof fetchImpl !== 'function') return async () => { throw new Error('CHALLENGE_UNAVAILABLE'); };
  return async token => {
    if (typeof token !== 'string' || !token || token.length > 2048) return false;
    let result;
    try {
      const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ secret, response:token }), redirect:'error', signal:AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error();
      result = await response.json();
    } catch { throw new Error('CHALLENGE_UNAVAILABLE'); }
    if (result?.success === true) return result.hostname === hostname && result.action === 'rawaa_order';
    const codes = result?.['error-codes'];
    const tokenErrors = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate']);
    if (result?.success === false && Array.isArray(codes) && codes.length > 0 && codes.every(code => tokenErrors.has(code))) return false;
    // Includes provider errors, secret/configuration errors, and malformed replies.
    throw new Error('CHALLENGE_UNAVAILABLE');
  };
}
