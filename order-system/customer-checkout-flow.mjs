/** Local orchestration only; UI must clearly show pending/uncertain outcomes. */
export function createCheckoutFlow({client, challenge}) {
  if(typeof client?.begin!=='function'||typeof client?.submit!=='function'||typeof client?.reset!=='function'||
     typeof client?.state!=='function'||typeof challenge?.take!=='function'||typeof challenge?.reset!=='function')throw Error('INVALID_CONFIGURATION');
  let busy=false, started=false;
  function begin(order) {
    if(busy || started)throw Error('INTENT_IN_PROGRESS');
    client.begin(order);started=true;
  }
  async function submit(consent, marketingConsent = false) {
    if(!started)throw Error('NO_INTENT');
    if(busy)throw Error('IN_FLIGHT');
    if(consent!==true)return {status:'consent_required'};
    if(typeof marketingConsent!=='boolean')return {status:'invalid_marketing_consent'};
    const challengeToken=challenge.take();
    if(!challengeToken)return {status:'challenge_required'};
    busy=true;
    try {
      return await client.submit({challengeToken,consent:true,marketingConsent});
    } finally {
      // Tokens are single-use even on network failure or provider errors.
      try {challenge.reset();} catch { /* Never mask a confirmed save or an uncertain result. */ }
      busy=false;
    }
  }
  function revise(order) {
    if(busy)throw Error('IN_FLIGHT');
    if(!started || typeof client.revise!=='function')throw Error('REVISION_NOT_ALLOWED');
    client.revise(order);
  }
  function reset() {
    if(busy)throw Error('IN_FLIGHT');
    client.reset(); // A possibly saved order must never be discarded here.
    started=false;
    try {challenge.reset();} catch { /* No successful order result should be lost. */ }
  }
  function state(){return client.state();}
  return {begin,submit,revise,reset,state};
}
