/** An authenticated owner may request one fixed, non-customer test message. */
export function createTestMessageHandler({ownerId, allowedOrigin, verifyUser, sendTest}) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const configured=typeof ownerId==='string'&&uuid.test(ownerId)&&typeof allowedOrigin==='string'&&/^https:\/\/[^/]+$/.test(allowedOrigin)&&typeof verifyUser==='function'&&typeof sendTest==='function';
  function json(status,body,origin) {return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff','vary':'Origin',...(origin===allowedOrigin?{'access-control-allow-origin':origin}:{})}});}
  return async req=>{
    const origin=req.headers.get('origin');
    if(!configured)return json(503,{error:'unavailable'});
    if(origin!==allowedOrigin)return json(403,{error:'forbidden'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey','cache-control':'no-store','vary':'Origin'}});
    if(req.method!=='POST')return json(405,{error:'method_not_allowed'},origin);
    const match=/^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(req.headers.get('authorization')||'');
    if(!match)return json(401,{error:'unauthorized'},origin);
    let user;try{user=await verifyUser(match[1]);}catch{return json(401,{error:'unauthorized'},origin);}
    if(typeof user?.id!=='string'||user.id.toLowerCase()!==ownerId.toLowerCase())return json(403,{error:'forbidden'},origin);
    if (new URL(req.url).search || (req.headers.has('content-length') && req.headers.get('content-length') !== '0')) return json(400,{error:'invalid_request'},origin);
    if (req.body) {
      try { const reader=req.body.getReader(); let done=false; for(let n=0;n<8;n++){ const chunk=await reader.read(); if(chunk.done){done=true;break;} if(chunk.value.byteLength)break; } if(!done){ await reader.cancel(); return json(400,{error:'invalid_request'},origin); } }
      catch { return json(400,{error:'invalid_request'},origin); }
    }
    try{const result=await sendTest();if(result?.ok===true)return json(200,{ok:true},origin);return json(503,{error:result?.reason==='unknown'?'unknown':'unavailable'},origin);}catch{return json(503,{error:'unknown'},origin);}
  };
}
