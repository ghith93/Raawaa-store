/** Local, injected widget adapter. Never writes tokens to storage or logs. */
export function createTurnstileController({ turnstile, container, sitekey, action = 'rawaa_order', onChange = () => {} }) {
  if (typeof turnstile?.render !== 'function' || typeof turnstile?.reset !== 'function' ||
      typeof turnstile?.remove !== 'function' || !container || typeof sitekey !== 'string' ||
      !/^[A-Za-z0-9_-]{20,}$/.test(sitekey) || action !== 'rawaa_order' || typeof onChange !== 'function') throw Error('INVALID_CONFIGURATION');
  let token=null, active=true, widgetId;
  const clear = reason => { token=null; if(active) onChange(reason); };
  widgetId=turnstile.render(container, {
    sitekey, action,
    callback: value => { if(active && typeof value==='string' && value.length>0 && value.length<=2048) { token=value; onChange('ready'); } else clear('error'); },
    'expired-callback': () => clear('expired'),
    'error-callback': () => clear('error'),
    'timeout-callback': () => clear('expired')
  });
  if(typeof widgetId!=='string' || !widgetId) { active=false; throw Error('WIDGET_UNAVAILABLE'); }
  function take() { const current=token; token=null; return current; }
  function reset() { if(!active)throw Error('WIDGET_UNAVAILABLE'); clear('pending'); turnstile.reset(widgetId); }
  function destroy() { if(!active)return; active=false; token=null; turnstile.remove(widgetId); }
  return {take,reset,destroy};
}
