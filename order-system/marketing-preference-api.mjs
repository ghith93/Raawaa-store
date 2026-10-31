const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const MAX_BODY = 1024;

function json(status, body, origin, allowedOrigin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'vary': 'Origin'
  };
  if (origin === allowedOrigin) headers['access-control-allow-origin'] = allowedOrigin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function readBoundedBody(request) {
  if (!request.body) throw new Error('INVALID_BODY');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) {
        await reader.cancel();
        throw new Error('BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Owner-only withdrawal recorder. A persistence adapter must append an immutable
 * HMAC-keyed event. The customer-facing WhatsApp draft does not call this API.
 */
function validAllowedOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && url.pathname === '/' &&
      !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function createMarketingPreferenceHandler({ ownerId, allowedOrigin, verifyUser, service }) {
  const configured = typeof ownerId === 'string' && UUID.test(ownerId) &&
    validAllowedOrigin(allowedOrigin) && typeof verifyUser === 'function' &&
    typeof service?.recordWithdrawal === 'function';

  return async function handle(request) {
    const origin = request.headers.get('origin');
    if (!configured) return json(503, { error: 'unavailable' }, origin, allowedOrigin);
    if (origin !== allowedOrigin) return json(403, { error: 'forbidden' }, origin, allowedOrigin);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, apikey, content-type',
        'cache-control': 'no-store',
        'vary': 'Origin'
      } });
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, origin, allowedOrigin);

    let url;
    try { url = new URL(request.url); } catch { return json(400, { error: 'invalid_request' }, origin, allowedOrigin); }
    if (url.search || url.hash || !JSON_TYPE.test(request.headers.get('content-type') || '')) {
      return json(400, { error: 'invalid_request' }, origin, allowedOrigin);
    }
    const contentLength = request.headers.get('content-length');
    if (contentLength !== null && (!/^\d{1,4}$/.test(contentLength) || Number(contentLength) > MAX_BODY)) {
      return json(413, { error: 'too_large' }, origin, allowedOrigin);
    }

    const auth = request.headers.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(auth);
    if (!match) return json(401, { error: 'unauthorized' }, origin, allowedOrigin);
    let user;
    try { user = await verifyUser(match[1]); } catch { return json(401, { error: 'unauthorized' }, origin, allowedOrigin); }
    if (!user || typeof user.id !== 'string') return json(401, { error: 'unauthorized' }, origin, allowedOrigin);
    if (user.id.toLowerCase() !== ownerId.toLowerCase()) return json(403, { error: 'forbidden' }, origin, allowedOrigin);

    let body;
    try {
      const text = await readBoundedBody(request);
      body = JSON.parse(text);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'action,phone' || body.action !== 'withdraw' ||
          typeof body.phone !== 'string' || body.phone.length < 7 || body.phone.length > 40) throw new Error();
    } catch (error) {
      return json(error?.message === 'BODY_TOO_LARGE' ? 413 : 400,
        { error: error?.message === 'BODY_TOO_LARGE' ? 'too_large' : 'invalid_request' }, origin, allowedOrigin);
    }

    try {
      const result = await service.recordWithdrawal({ phone: body.phone, ownerAuthorized: true });
      if (!result?.recorded) return json(400, { error: 'invalid_request' }, origin, allowedOrigin);
      // Never disclose whether the phone had a previous order or opt-in.
      return json(200, { ok: true }, origin, allowedOrigin);
    } catch {
      return json(503, { error: 'unavailable' }, origin, allowedOrigin);
    }
  };
}
