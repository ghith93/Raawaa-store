// Temporary identity-header probe used by the static iPhone setup page at /setup.html.
// The probe only returns headers for the current request; it stores nothing.
// Delete this function after the owner finishes the setup checks.
const NAMES = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip'];
const ALLOWED_ORIGIN = 'https://raawaa-store.pages.dev';
const ALLOWED_HEADERS = new Set(['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip']);

Deno.serve(request => {
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    const method = request.headers.get('access-control-request-method');
    const requestedHeaders = (request.headers.get('access-control-request-headers') || '')
      .toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
    if (origin !== ALLOWED_ORIGIN || method !== 'POST' || requestedHeaders.some(name => !ALLOWED_HEADERS.has(name))) {
      return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': ALLOWED_ORIGIN,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': [...ALLOWED_HEADERS].join(', '),
        'access-control-max-age': '600',
        'cache-control': 'no-store',
        vary: 'Origin'
      }
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST, OPTIONS', 'cache-control': 'no-store' } });
  }

  const seen = {};
  for (const name of NAMES) seen[name] = request.headers.get(name);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin'
  };
  if (origin === ALLOWED_ORIGIN) headers['access-control-allow-origin'] = ALLOWED_ORIGIN;
  return new Response(JSON.stringify(seen), { status: 200, headers });
});
