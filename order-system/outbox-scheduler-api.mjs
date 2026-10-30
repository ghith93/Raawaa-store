/**
 * Trusted scheduler only. The secret must come from a protected server-side store,
 * not a publishable API key. Never log headers or database/provider errors.
 */
export function createOutboxSchedulerHandler({ secret, runBatch }) {
  const valid = typeof secret==='string' && /^[A-Za-z0-9_-]{43,256}$/.test(secret) && typeof runBatch==='function';
  const encode=value=>new TextEncoder().encode(value);
  const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',encode(value)));
  const expected=valid ? hash(secret) : null;
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff'}});
  return async request=>{
    if(!valid)return respond(503,{error:'unavailable'});
    if(request.method!=='POST')return respond(405,{error:'method_not_allowed'});
    // The endpoint receives no order data or user-provided batch controls.
    if(new URL(request.url).search)return respond(400,{error:'invalid_request'});
    const match=/^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(request.headers.get('authorization') || '');
    if(!match)return respond(401,{error:'unauthorized'});
    const [actual,correct]=await Promise.all([hash(match[1]),expected]);let diff=0;
    for(let i=0;i<correct.length;i++)diff|=actual[i]^correct[i];
    if(diff!==0)return respond(401,{error:'unauthorized'});
    const declared=request.headers.get('content-length');
    if(declared && (!/^[0-9]+$/.test(declared) || Number(declared)>1024))return respond(413,{error:'too_large'});
    try {
      if(request.body){const reader=request.body.getReader();let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024){await reader.cancel();return respond(413,{error:'too_large'});}}}
    }catch{return respond(400,{error:'invalid_request'});}
    try {
      const result=await runBatch();
      if(result?.ok!==true)return respond(503,{error:'unavailable'});
      // Never return chat identifiers, order references, or customer data.
      return respond(200,{ok:true});
    }catch{return respond(503,{error:'unavailable'});}
  };
}
