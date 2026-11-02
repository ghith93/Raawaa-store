// Public Hyperliquid read-only API. No signing, accounts, or trading endpoints.
const HOUR=3600000, CHUNK=400*HOUR;
export function normalizeMarket(candles, fundings, start, end) {
  if (!Array.isArray(candles) || !Array.isArray(fundings)) throw new Error('رد غير متوقع من مصدر البيانات.');
  const cm=new Map(), fm=new Map();
  for (const c of candles) { const t=Number(c.t)+HOUR, p=Number(c.c); if (Number.isFinite(t) && Number.isFinite(p) && p>0) cm.set(t,p); }
  for (const f of fundings) { const t=Number(f.time), rate=Number(f.fundingRate); if (Number.isFinite(t) && Number.isFinite(rate) && Math.abs(rate)<=0.04) fm.set(t,rate); }
  const rows=[];
  for(let t=start; t<=end; t+=HOUR) {
    if(!cm.has(t) || !fm.has(t)) throw new Error(`بيانات ناقصة أو غير متطابقة عند ${new Date(t).toISOString()}. لم يُشغّل الاختبار لتجنب اختلاق القيم.`);
    rows.push({time:t,price:cm.get(t),funding:fm.get(t)});
  }
  if(rows.length<3) throw new Error('نحتاج إلى ثلاث ساعات مكتملة على الأقل.');
  return rows;
}
export async function fetchHistory(post,start,end,onProgress=()=>{}) {
  const candles=[],fundings=[];
  // Boundaries refer to closed candles: the candle beginning at t-HOUR closes at t.
  for(let from=start;from<=end;from+=CHUNK){
    const to=Math.min(end,from+CHUNK-HOUR);
    onProgress(from,to);
    const [c,f]=await Promise.all([
      post({type:'candleSnapshot',req:{coin:'HYPE',interval:'1h',startTime:from-HOUR,endTime:to-HOUR}}),
      post({type:'fundingHistory',coin:'HYPE',startTime:from,endTime:to})
    ]);
    if(!Array.isArray(c)||!Array.isArray(f)) throw new Error('استجابة تاريخية غير صالحة من Hyperliquid.');
    candles.push(...c); fundings.push(...f);
  }
  return normalizeMarket(candles,fundings,start,end);
}
export async function connectInfo() {
  const ws=new WebSocket('wss://api.hyperliquid.xyz/ws');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.close();reject(new Error('انتهت مهلة الاتصال بـ Hyperliquid.'))},12000);ws.onopen=()=>{clearTimeout(timer);resolve()};ws.onerror=()=>{clearTimeout(timer);reject(new Error('تعذر الاتصال بـ Hyperliquid من شبكتك أو متصفحك.'))}});
  let id=0; const pending=new Map();
  ws.onmessage=e=>{let msg;try{msg=JSON.parse(e.data)}catch{return} if(msg.channel!=='post')return;const p=pending.get(msg.data?.id);if(!p)return;pending.delete(msg.data.id);clearTimeout(p.timer);const r=msg.data.response;if(r?.type==='error')p.reject(new Error(`خطأ API: ${String(r.payload).slice(0,180)}`));else if(r?.type==='info' && r.payload) p.resolve(r.payload.data); else p.reject(new Error('استجابة API غير متوقعة.'));};
  ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('انقطع الاتصال أثناء جلب البيانات.'))}pending.clear()};
  return {post:payload=>new Promise((resolve,reject)=>{if(ws.readyState!==WebSocket.OPEN)return reject(new Error('الاتصال مغلق.'));const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error('انتهت مهلة طلب البيانات.'))},20000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({method:'post',id:n,request:{type:'info',payload}}));}),close:()=>ws.close()};
}
export const hour=HOUR;
