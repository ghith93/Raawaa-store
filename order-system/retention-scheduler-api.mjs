/** Private machine endpoint for invoking the existing bounded contact-redaction SQL function. */
export function createRetentionSchedulerHandler({ secret, runCleanup }) {
  const valid = typeof secret === 'string' && /^[A-Za-z0-9_-]{43,256}$/.test(secret) && typeof runCleanup === 'function';
  const encode = value => new TextEncoder().encode(value);
  const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encode(value)));
  const expected = valid ? hash(secret) : null;
  const respond = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff'
    }
  });

  return async request => {
    if (!valid) return respond(503, { error: 'unavailable' });
    if (request.method !== 'POST') return respond(405, { error: 'method_not_allowed' });
    // No customer data, SQL, batch size, or other caller-controlled options are accepted.
    if (new URL(request.url).search) return respond(400, { error: 'invalid_request' });
    const match = /^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(request.headers.get('authorization') || '');
    if (!match) return respond(401, { error: 'unauthorized' });
    const [actual, correct] = await Promise.all([hash(match[1]), expected]);
    let difference = 0;
    for (let index = 0; index < correct.length; index++) difference |= actual[index] ^ correct[index];
    if (difference !== 0) return respond(401, { error: 'unauthorized' });

    const declaredLength = request.headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 0)) {
      return respond(400, { error: 'invalid_request' });
    }
    try {
      if (request.body) {
        const reader = request.body.getReader();
        const part = await reader.read();
        if (!part.done || part.value?.byteLength) {
          await reader.cancel();
          return respond(400, { error: 'invalid_request' });
        }
      }
    } catch {
      return respond(400, { error: 'invalid_request' });
    }
    try {
      await runCleanup();
      // Never return row counts or customer/order data to the scheduler.
      return respond(200, { ok: true });
    } catch {
      return respond(503, { error: 'unavailable' });
    }
  };
}
