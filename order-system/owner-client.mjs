/** Server-backed client, not connected to the demo. Holds the access token in memory only. */
export function createOwnerClient({ supabaseUrl, publishableKey, ownerEndpoint, fetchImpl = fetch, now = Date.now }) {
  const base = new URL(supabaseUrl);
  const endpoint = new URL(ownerEndpoint);
  if (base.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname) || base.pathname !== '/' || base.search || base.hash || base.username || base.password || base.port ||
      endpoint.protocol !== 'https:' || ![base.hostname, base.hostname.replace('.supabase.co', '.functions.supabase.co')].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash ||
      typeof publishableKey !== 'string' || !publishableKey || typeof fetchImpl !== 'function') throw new Error('INVALID_CONFIGURATION');
  const authUrl = `${base.origin}/auth/v1`;
  let token = null, expires = 0, generation = 0;
  const options = { credentials: 'omit', cache: 'no-store', redirect: 'error' };
  async function login(email, password) {
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) throw new Error('LOGIN_FAILED');
    const current = ++generation; token = null; expires = 0;
    try {
      const response = await fetchImpl(`${authUrl}/token?grant_type=password`, { ...options, method: 'POST', headers: { apikey: publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
      if (!response.ok) throw new Error('LOGIN_FAILED');
      const data = await response.json();
      if (current !== generation || typeof data.access_token !== 'string' || !/^[A-Za-z0-9._~-]{1,8192}$/.test(data.access_token) || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('LOGIN_FAILED');
      token = data.access_token; expires = now() + data.expires_in * 1000;
    } catch { throw new Error('LOGIN_FAILED'); }
  }
  async function list(cursor = null) {
    if (!token || now() >= expires) { token = null; expires = 0; throw new Error('SESSION_EXPIRED'); }
    const requestToken = token, current = generation;
    const url = new URL(endpoint);
    if (cursor !== null) {
      if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(cursor)) throw new Error('INVALID_CURSOR');
      url.searchParams.set('cursor', cursor);
    }
    try {
      const response = await fetchImpl(url.href, { ...options, method: 'GET', headers: { apikey: publishableKey, authorization: `Bearer ${requestToken}` } });
      if (current !== generation) throw new Error('SESSION_EXPIRED');
      if (response.status === 401 || response.status === 403) { token = null; expires = 0; throw new Error('SESSION_EXPIRED'); }
      if (!response.ok) throw new Error('LOAD_FAILED');
      const data = await response.json();
      if (current !== generation || !Array.isArray(data.orders) || data.orders.length > 50 || (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(data.nextCursor)))) throw new Error('LOAD_FAILED');
      return data;
    } catch (err) { if (err.message === 'SESSION_EXPIRED') throw err; throw new Error('LOAD_FAILED'); }
  }
  async function logout() {
    const previous = token; token = null; expires = 0; generation++;
    if (!previous) return;
    try { await fetchImpl(`${authUrl}/logout`, { ...options, method: 'POST', headers: { apikey: publishableKey, authorization: `Bearer ${previous}` } }); } catch { /* local session is still cleared */ }
  }
  return { login, list, logout };
}
