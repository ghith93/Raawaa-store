/** Local prototype. Requires a protected endpoint and UI before production. */
export function createCustomerOrderClient({ endpoint, allowedOrigin, storage, fetchImpl = fetch, makeId = () => crypto.randomUUID(), requestTimeoutMs = 15000 }) {
  let parsed, origin;
  try {
    parsed = new URL(endpoint); origin = new URL(allowedOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== allowedOrigin || parsed.protocol !== 'https:' ||
        parsed.origin !== origin.origin || parsed.username || parsed.password || parsed.search || parsed.hash ||
        typeof fetchImpl !== 'function' || typeof makeId !== 'function' ||
        !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30000 ||
        typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function' || typeof storage?.removeItem !== 'function') throw Error();
  } catch { throw new Error('INVALID_CONFIGURATION'); }
  const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const refPattern = /^RAWAA-[A-Z0-9]{6,30}$/;
  const storageKey = 'rawaa-order-intent-v1';
  let intent = null, inFlight = false, restored = null;
  try {
    const raw=storage.getItem(storageKey);
    if(raw!==null){
      const saved=JSON.parse(raw);
      if (!saved || typeof saved!=='object' || !keyPattern.test(saved.key) || !['pending','complete'].includes(saved.phase) ||
          (saved.phase==='pending' && Object.keys(saved).sort().join(',')!=='key,phase') ||
          (saved.phase==='complete' && (Object.keys(saved).sort().join(',')!=='key,phase,reference' || !refPattern.test(saved.reference)))) throw Error();
      restored=saved;
    }
  } catch { throw new Error('STORAGE_UNAVAILABLE'); }
  function persist(value) {
    try {storage.setItem(storageKey,JSON.stringify(value));if(storage.getItem(storageKey)!==JSON.stringify(value))throw Error();}
    catch {throw new Error('STORAGE_UNAVAILABLE');}
    restored=value;
  }
  function begin(order) {
    if (intent || inFlight || restored?.phase==='complete') throw new Error('INTENT_IN_PROGRESS');
    // Neither form data nor a fingerprint of it is stored in the browser.
    const copy=structuredClone(order);
    if (!copy || typeof copy!=='object' || Array.isArray(copy)) throw new Error('INVALID_ORDER');
    const key=restored?.key ?? makeId();
    if (typeof key!=='string' || !keyPattern.test(key)) throw new Error('INVALID_CONFIGURATION');
    intent={order:copy,key,phase:restored?.phase==='pending'?'uncertain':'ready',usedChallenges:new Set()};
  }
  async function submit({challengeToken, consent}) {
    if (!intent) throw new Error('NO_INTENT');
    if (inFlight) throw new Error('IN_FLIGHT');
    if (intent.phase==='complete') throw new Error('ALREADY_COMPLETE');
    if (consent!==true || typeof challengeToken!=='string' || !challengeToken || challengeToken.length>2048 || intent.usedChallenges.has(challengeToken)) throw new Error('INVALID_CHALLENGE');
    // Persist only a random key before sending. After reload, user must re-enter
    // the same details; the server enforces key/intent consistency atomically.
    persist({key:intent.key,phase:'pending'});
    const current=intent;current.usedChallenges.add(challengeToken);inFlight=true;
    try {
      const response=await fetchImpl(parsed.href,{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(requestTimeoutMs),
        headers:{'content-type':'application/json'},body:JSON.stringify({order:current.order,idempotencyKey:current.key,challengeToken,consent:true})});
      if(response.status===200){
        const data=await response.json();
        if(typeof data?.reference==='string' && refPattern.test(data.reference) && data.status==='pending_review'){
          current.phase='complete';
          // If this write fails, keep the pending key: retry is safer than duplication.
          try {persist({key:current.key,phase:'complete',reference:data.reference});} catch { /* saved response still authoritative */ }
          return {status:'saved',reference:data.reference};
        }
        current.phase='uncertain';return {status:'uncertain'};
      }
      if([400,403,413,415,429].includes(response.status)) {
        // A rejection of this retry cannot prove that a prior attempt was not saved.
        // Preserve the unresolved outcome, especially after a reload.
        if(current.phase==='uncertain') return {status:'uncertain'};
        return {status:'rejected',reason:response.status===429?'try_later':'check_details'};
      }
      current.phase='uncertain';return {status:'uncertain'};
    } catch {current.phase='uncertain';return {status:'uncertain'};}
    finally {inFlight=false;}
  }
  function reset() {
    if(inFlight)throw new Error('IN_FLIGHT');
    if(intent?.phase==='uncertain'||(!intent && restored?.phase==='pending'))throw new Error('SAVE_UNCERTAIN');
    try{storage.removeItem(storageKey);if(storage.getItem(storageKey)!==null)throw Error();}catch{throw new Error('STORAGE_UNAVAILABLE');}
    intent=null;restored=null;
  }
  function state(){return intent?.phase ?? (restored?.phase==='pending'?'uncertain':restored?.phase==='complete'?'complete':'idle');}
  function restoredReference(){return restored?.phase==='complete'?restored.reference:null;}
  return {begin,submit,reset,state,restoredReference};
}
