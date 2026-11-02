/** Local prototype. Requires a protected endpoint and UI before production. */
const STORAGE_KEY = 'rawaa-order-intent-v1';
const MAX_UNCERTAIN_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export function createCustomerOrderClient(options = {}) {
  const {
    endpoint, allowedOrigin, fetchImpl = fetch,
    makeId = () => crypto.randomUUID(),
    requestTimeoutMs = 15000,
    now = Date.now
  } = options;
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; }
    catch { throw new Error('STORAGE_UNAVAILABLE'); }
  }

  let parsed, origin;
  try {
    parsed = new URL(endpoint); origin = new URL(allowedOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== allowedOrigin || parsed.protocol !== 'https:' ||
        parsed.origin !== origin.origin || parsed.username || parsed.password || parsed.search || parsed.hash ||
        typeof fetchImpl !== 'function' || typeof makeId !== 'function' || typeof now !== 'function' ||
        !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30000) throw Error();
  } catch { throw new Error('INVALID_CONFIGURATION'); }
  if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function' || typeof storage?.removeItem !== 'function') {
    throw new Error('STORAGE_UNAVAILABLE');
  }

  const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const refPattern = /^RAWAA-[A-Z0-9]{6,30}$/;
  let intent = null, inFlight = false, restored = null, mayRevise = false, completedReference = null;

  function validStoredKey(saved) {
    return saved && typeof saved === 'object' && !Array.isArray(saved) && keyPattern.test(saved.key);
  }
  function isExpired(value) {
    const currentTime = now();
    return !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0 ||
      !Number.isSafeInteger(currentTime) || value.createdAt > currentTime + 5 * 60 * 1000 ||
      currentTime - value.createdAt >= MAX_UNCERTAIN_AGE_MS;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const saved = JSON.parse(raw);
      if (!validStoredKey(saved)) throw Error();
      const fields = Object.keys(saved).sort().join(',');
      if (saved.phase === 'pending' && fields === 'key,phase') {
        // Old prototype records had no age metadata. Preserve their key, but
        // require manual reconciliation instead of risking reuse after expiry.
        restored = { key: saved.key, phase: 'pending', createdAt: 0 };
      } else if (saved.phase === 'pending' && fields === 'createdAt,key,phase' &&
          Number.isSafeInteger(saved.createdAt) && saved.createdAt >= 0) {
        restored = saved;
      } else if (saved.phase === 'complete' && fields === 'key,phase,reference' &&
          refPattern.test(saved.reference)) {
        // Older prototype versions persisted the order reference. A confirmed
        // save needs no retry key; remove that legacy record and its reference.
        storage.removeItem(STORAGE_KEY);
        if (storage.getItem(STORAGE_KEY) !== null) throw Error();
      } else {
        throw Error();
      }
    }
  } catch { throw new Error('STORAGE_UNAVAILABLE'); }

  function persist(value) {
    try {
      const serialized = JSON.stringify(value);
      storage.setItem(STORAGE_KEY, serialized);
      if (storage.getItem(STORAGE_KEY) !== serialized) throw Error();
    } catch { throw new Error('STORAGE_UNAVAILABLE'); }
    restored = value;
  }
  function clearPersisted() {
    try {
      storage.removeItem(STORAGE_KEY);
      if (storage.getItem(STORAGE_KEY) !== null) throw Error();
      restored = null;
      return true;
    } catch { return false; }
  }
  function begin(order) {
    if (intent || inFlight || restored?.phase === 'complete') throw new Error('INTENT_IN_PROGRESS');
    // Neither form data nor a fingerprint is stored in browser storage.
    const copy = structuredClone(order);
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error('INVALID_ORDER');
    const key = restored?.key ?? makeId();
    if (typeof key !== 'string' || !keyPattern.test(key)) throw new Error('INVALID_CONFIGURATION');
    const createdAt = restored?.createdAt ?? now();
    if (!restored && (!Number.isSafeInteger(createdAt) || createdAt <= 0)) throw new Error('CLOCK_UNAVAILABLE');
    const expired = restored?.phase === 'pending' && isExpired(restored);
    intent = {
      order: copy, key, createdAt,
      phase: expired ? 'reconciliation_required' : restored?.phase === 'pending' ? 'uncertain' : 'ready',
      usedChallenges: new Set()
    };
  }
  async function submit({ challengeToken, consent, marketingConsent = false }) {
    if (!intent) throw new Error('NO_INTENT');
    if (inFlight) throw new Error('IN_FLIGHT');
    if (intent.phase === 'reconciliation_required' || isExpired(intent)) {
      intent.phase = 'reconciliation_required';
      return { status: 'reconciliation_required' };
    }
    if (intent.phase === 'complete') throw new Error('ALREADY_COMPLETE');
    if (typeof marketingConsent !== 'boolean') throw new Error('INVALID_MARKETING_CONSENT');
    if (consent !== true || typeof challengeToken !== 'string' || !challengeToken || challengeToken.length > 2048 || intent.usedChallenges.has(challengeToken)) {
      throw new Error('INVALID_CHALLENGE');
    }
    // Persist only the random key before sending. localStorage lets a retry
    // survive tab/browser closure; order details and references never persist.
    persist({ key: intent.key, phase: 'pending', createdAt: intent.createdAt });
    const current = intent; current.usedChallenges.add(challengeToken); inFlight = true;
    try {
      const response = await fetchImpl(parsed.href, {
        method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs), headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order: current.order, idempotencyKey: current.key, challengeToken, consent: true, marketingConsent })
      });
      if (response.status === 200) {
        const data = await response.json();
        if (typeof data?.reference === 'string' && refPattern.test(data.reference) && data.status === 'pending_review') {
          current.phase = 'complete';
          completedReference = data.reference;
          // The server confirmed persistence, so the local key is no longer
          // needed. If cleanup fails, leave the pending key: that only permits
          // an idempotent retry and never creates a second order.
          clearPersisted(); // The confirmed response remains authoritative if storage cleanup fails.
          const marketingOptInStatus = ['recorded', 'not_recorded', 'unknown'].includes(data.marketingOptInStatus)
            ? data.marketingOptInStatus : 'unknown';
          return { status: 'saved', reference: data.reference,
            ...(marketingConsent ? { marketingOptInStatus } : {}) };
        }
        current.phase = 'uncertain'; return { status: 'uncertain' };
      }
      if (response.status === 409) {
        const data = await response.json();
        current.phase = 'uncertain';
        if (data?.error === 'intent_mismatch') { mayRevise = true; return { status: 'intent_mismatch' }; }
        return { status: 'uncertain' };
      }
      if ([400, 403, 413, 415, 429].includes(response.status)) {
        // A rejection of this retry cannot prove an earlier attempt was not saved.
        if (current.phase === 'uncertain') return { status: 'uncertain' };
        clearPersisted(); // First-attempt rejection is definitive; it is safe to start over after reload.
        return { status: 'rejected', reason: response.status === 429 ? 'try_later' : 'check_details' };
      }
      current.phase = 'uncertain'; return { status: 'uncertain' };
    } catch { current.phase = 'uncertain'; return { status: 'uncertain' }; }
    finally { inFlight = false; }
  }
  // Only after the server reports a mismatch; keep the key and used tokens.
  function revise(order) {
    if (inFlight) throw new Error('IN_FLIGHT');
    if (!intent || intent.phase !== 'uncertain' || !mayRevise || isExpired(intent)) throw new Error('REVISION_NOT_ALLOWED');
    const copy = structuredClone(order);
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error('INVALID_ORDER');
    intent.order = copy; mayRevise = false;
  }
  function reset() {
    if (inFlight) throw new Error('IN_FLIGHT');
    if (intent?.phase === 'uncertain' || intent?.phase === 'reconciliation_required' ||
        (!intent && restored?.phase === 'pending')) throw new Error('SAVE_UNCERTAIN');
    try {
      storage.removeItem(STORAGE_KEY);
      if (storage.getItem(STORAGE_KEY) !== null) throw Error();
    } catch { throw new Error('STORAGE_UNAVAILABLE'); }
    intent = null; restored = null; mayRevise = false; completedReference = null;
  }
  function state() {
    if (intent?.phase === 'uncertain' && isExpired(intent)) return 'reconciliation_required';
    return intent?.phase ?? (restored?.phase === 'pending'
      ? isExpired(restored) ? 'reconciliation_required' : 'uncertain'
      : restored?.phase === 'complete' ? 'complete' : 'idle');
  }
  // Kept in memory only; confirmed references are never persisted locally.
  function restoredReference() { return completedReference; }
  return { begin, submit, revise, reset, state, restoredReference };
}
