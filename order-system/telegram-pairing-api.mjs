/** Owner-only pairing endpoint; never put pairing codes in URLs or logs. */
export function createPairingHandler({ ownerId, allowedOrigin, verifyUser, pairing }) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const configured = typeof ownerId === 'string' && uuid.test(ownerId) &&
    typeof allowedOrigin === 'string' && /^https:\/\/[^/]+$/.test(allowedOrigin) &&
    typeof verifyUser === 'function' && typeof pairing?.start === 'function' && typeof pairing?.finish === 'function';
  const response = (status, data, origin) => {
    const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store, private',
      'x-content-type-options':'nosniff', 'vary':'Origin' };
    if (origin === allowedOrigin) headers['access-control-allow-origin'] = origin;
    return new Response(JSON.stringify(data), { status, headers });
  };
  return async request => {
    const origin = request.headers.get('origin');
    if (!configured) return response(503, {error:'unavailable'});
    // Require the configured browser origin even for POST. No cookie authentication.
    if (origin !== allowedOrigin) return response(403, {error:'forbidden'});
    if (request.method === 'OPTIONS') return new Response(null, {status:204,headers:{
      'access-control-allow-origin':origin, 'access-control-allow-methods':'POST, OPTIONS',
      'access-control-allow-headers':'authorization, apikey, content-type', 'cache-control':'no-store', 'vary':'Origin'
    }});
    if (request.method !== 'POST') return response(405, {error:'method_not_allowed'}, origin);
    const auth = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(request.headers.get('authorization') || '');
    if (!auth) return response(401, {error:'unauthorized'}, origin);
    let user;
    try { user = await verifyUser(auth[1]); } catch { return response(401, {error:'unauthorized'}, origin); }
    if (!user || typeof user.id !== 'string' || user.id.toLowerCase() !== ownerId.toLowerCase()) return response(403, {error:'forbidden'}, origin);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return response(415, {error:'invalid_request'}, origin);
    let body;
    try {
      if (request.headers.has('content-length') && (!/^\d+$/.test(request.headers.get('content-length')) || Number(request.headers.get('content-length')) > 1024)) throw new Error();
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      const parts = []; let length = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 1024) { await reader.cancel(); throw new Error(); }
        parts.push(chunk.value);
      }
      const bytes = new Uint8Array(length); let offset=0;
      for (const part of parts) { bytes.set(part,offset); offset+=part.byteLength; }
      body = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    } catch { return response(400, {error:'invalid_request'}, origin); }
    const keys = Object.keys(body).sort().join(',');
    try {
      let result;
      if (keys === 'action' && body.action === 'start') result = await pairing.start();
      else if (keys === 'action' && body.action === 'finish') result = await pairing.finish();
      else return response(400, {error:'invalid_request'}, origin);
      if (!result?.ok) {
        const error = ['invalid','not_found','ambiguous','unavailable'].includes(result?.error) ? result.error : 'unavailable';
        return response(error === 'unavailable' ? 503 : 400, {error}, origin);
      }
      if (body.action === 'finish') return response(200, {ok:true}, origin);
      if (typeof result.id !== 'string' || !uuid.test(result.id) || typeof result.message !== 'string' || !/^\/pair [0-9a-f]{32}$/.test(result.message) || !Number.isFinite(result.expiresAt)) throw new Error();
      return response(200, {ok:true,id:result.id,message:result.message,expiresAt:result.expiresAt}, origin);
    } catch { return response(503, {error:'unavailable'}, origin); }
  };
}
