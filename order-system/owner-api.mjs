/**
 * Owner-only HTTP handler, staged but not deployed. verifyUser(token) MUST verify
 * the access token with a trusted identity provider, not decode it unchecked.
 * The trusted owner ID and allowed origin must be server-side configuration.
 */
export function createOwnerHandler({ ownerId, allowedOrigin, verifyUser, repository }) {
  const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const configured = typeof ownerId === 'string' && idPattern.test(ownerId) &&
    typeof allowedOrigin === 'string' && /^https:\/\/[^/]+$/.test(allowedOrigin) &&
    typeof verifyUser === 'function' && typeof repository?.listRecent === 'function';
  const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
  function encodeCursor(row) {
    if (!idPattern.test(row.cursor_id) || !timePattern.test(row.cursor_time)) throw new Error('invalid cursor');
    return btoa(`${row.cursor_time}|${row.cursor_id}`).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }
  function decodeCursor(value) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('invalid cursor');
    const parts = atob(value.replaceAll('-', '+').replaceAll('_', '/')).split('|');
    if (parts.length !== 2 || !timePattern.test(parts[0]) || !Number.isFinite(Date.parse(parts[0])) || !idPattern.test(parts[1])) throw new Error('invalid cursor');
    return { time: parts[0], id: parts[1] };
  }
  const json = (status, body, origin) => {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff', 'vary': 'Origin' };
    if (origin && origin === allowedOrigin) headers['access-control-allow-origin'] = origin;
    return new Response(JSON.stringify(body), { status, headers });
  };
  return async function handle(request) {
    const origin = request.headers.get('origin');
    if (!configured) return json(503, { error: 'unavailable' });
    if (origin && origin !== allowedOrigin) return json(403, { error: 'forbidden' });
    if (request.method === 'OPTIONS') {
      if (origin !== allowedOrigin) return json(403, { error: 'forbidden' });
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'authorization, apikey',
        'cache-control': 'no-store', 'vary': 'Origin' } });
    }
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, origin);
    const auth = request.headers.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(auth);
    if (!match) return json(401, { error: 'unauthorized' }, origin);
    let user;
    try { user = await verifyUser(match[1]); } catch { return json(401, { error: 'unauthorized' }, origin); }
    if (!user || typeof user.id !== 'string' || user.id.toLowerCase() !== ownerId.toLowerCase()) {
      return json(403, { error: 'forbidden' }, origin);
    }
    let cursor = null;
    try {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => key !== 'cursor') || params.getAll('cursor').length > 1) throw new Error('invalid query');
      if (params.has('cursor')) cursor = decodeCursor(params.get('cursor'));
    } catch { return json(400, { error: 'invalid_cursor' }, origin); }
    try {
      const rows = await repository.listRecent(cursor);
      if (!Array.isArray(rows) || rows.length > 51) throw new Error('invalid result');
      const orders = rows.slice(0, 50).map(row => {
        const d = row.details;
        if (!d || typeof d !== 'object' || !Array.isArray(d.entries)) throw new Error('invalid order');
        return { reference: row.reference, createdAt: row.created_at, status: row.order_status,
          notification: row.notification_state,
          name: d.name, phone: d.phone, address: d.address, zone: d.zone, method: d.method,
          items: d.entries.map(item => ({ id: item.id, size: item.size, qty: item.qty, unitCents: item.unitCents })),
          scent: d.scent, oil: d.oil, oilPricePending: d.oilPricePending,
          subtotalCents: d.subtotalCents, discountCents: d.discountCents,
          deliveryCents: d.deliveryCents, totalCents: d.totalCents };
      });
      const nextCursor = rows.length > 50 ? encodeCursor(rows[49]) : null;
      return json(200, { orders, hasMore: Boolean(nextCursor), nextCursor }, origin);
    } catch {
      // Never disclose provider or database errors; they can contain customer data.
      return json(503, { error: 'unavailable' }, origin);
    }
  };
}

/** Trusted client may use supabase.auth.getUser(token); never getSession for authorization. */
export function supabaseUserVerifier(authClient) {
  return async token => {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return { id: data.user.id };
  };
}
