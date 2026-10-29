const $ = id => document.getElementById(id);
const demoOrders = [
  { reference:'RAWAA-DEMO001', createdAt:'2026-10-30T10:00:00Z', status:'pending_review', notification:'sent', name:'زبونة تجريبية', phone:'0990000000', address:'حماة — عنوان تجريبي', zone:'hama', method:'shamcash', items:[{size:'50 مل',qty:1}], scent:'vanilla', oil:'argan', oilPricePending:true, totalCents:2016 },
  { reference:'RAWAA-DEMO002', createdAt:'2026-10-29T10:00:00Z', status:'pending_review', notification:'unknown', name:'طلب تجريبي آخر', phone:'0990000001', address:'حمص — عنوان تجريبي', zone:'other', method:'cod', items:[{size:'30 مل',qty:2}], scent:'unscented', oil:'', oilPricePending:false, totalCents:3800 }
];
const demo = { async list(cursor) { return cursor ? {orders:[demoOrders[1]],nextCursor:null} : {orders:[demoOrders[0]],nextCursor:'demo-page-2'}; } };
const statusLabels = {pending_review:'بانتظار المراجعة',confirmed:'مؤكد',cancelled:'ملغي',fulfilled:'تم تجهيزه'};
const notificationLabels = {pending:'بانتظار الإرسال',sending:'جارٍ الإرسال',sent:'أُرسل إلى تيليغرام',failed:'فشل الإرسال',unknown:'حالة الإرسال غير مؤكدة'};
const scents = {unscented:'بلا عطر',vanilla:'فانيلا دافئة',rose:'ورد',oud:'عود شرقي',lavender:'لافندر',rosemary:'إكليل الجبل',jasmine:'ياسمين',ylang:'إيلانغ إيلانغ',mint:'نعناع'};
const oils = {argan:'أرجان',castor:'خروع',almond:'لوز حلو',jojoba:'جوجوبا',coconut:'جوز الهند',grapeseed:'بذور العنب'};
let cursor = null, busy = false, generation = 0;
function element(tag, text, className) { const node=document.createElement(tag); if(text != null) node.textContent=String(text); if(className) node.className=className; return node; }
function field(dl, name, value, cls='') { dl.append(element('dt',name),element('dd',value || '—',cls)); }
function card(order) {
  const box=element('article',null,'card'), head=element('div',null,'card-head'), meta=element('div');
  meta.append(element('strong',order.name || 'طلب'),element('span',order.reference,'ref'));
  head.append(meta,element('span',statusLabels[order.status] || 'للمراجعة','badge')); box.append(head);
  const dl=element('dl');
  field(dl,'الهاتف',order.phone); field(dl,'العنوان',order.address);
  field(dl,'المنتجات',(order.items || []).map(x => `${x.size} × ${x.qty}`).join('، '));
  field(dl,'العطر',scents[order.scent] || (order.scent ? 'يؤكد عند المراجعة' : 'غير محدد')); field(dl,'الزيت',oils[order.oil] || (order.oil ? 'يؤكد عند المراجعة' : 'بدون إضافة'));
  field(dl,'الدفع',order.method === 'shamcash' ? 'شام كاش' : order.method === 'cod' ? 'عند الاستلام' : 'غير محدد');
  field(dl,'التقدير',Number.isInteger(order.totalCents) ? `$${(order.totalCents/100).toFixed(2)}` : 'يؤكد عند المراجعة','total');
  field(dl,'التنبيه',notificationLabels[order.notification] || 'غير متاح'); box.append(dl);
  if(order.oilPricePending) box.append(element('p','سعر إضافة الزيت وتوفّرها يحتاجان تأكيدًا، ولا يدخل سعرها في التقدير.','caution'));
  if(order.notification === 'unknown' || order.notification === 'failed') box.append(element('p','راجع حالة التنبيه؛ لا تعني هذه الحالة أن الطلب غير محفوظ.','caution'));
  return box;
}
async function load(append=false) {
  if(busy) return; busy=true; const current=++generation; $('message').textContent='جارٍ تحميل الطلبات…'; $('more').disabled=true; $('refresh').disabled=true;
  try { const result=await demo.list(append ? cursor : null); if(current!==generation)return;
    if(!append) $('orders').replaceChildren();
    for(const order of result.orders) $('orders').append(card(order));
    cursor=result.nextCursor || null; $('more').hidden=!cursor;
    $('message').textContent=$('orders').children.length ? '' : 'لا توجد طلبات بعد.';
  } catch { if(current===generation) $('message').textContent='تعذر تحميل الطلبات. حاول مجددًا.'; }
  finally { if(current===generation) {busy=false; $('more').disabled=false; $('refresh').disabled=false;} }
}
$('open').addEventListener('click',()=>{ $('entry').hidden=true; $('dashboard').hidden=false; $('logout').hidden=false; load(); });
$('refresh').addEventListener('click',()=>load()); $('more').addEventListener('click',()=>load(true));
$('logout').addEventListener('click',()=>{ generation++; busy=false; cursor=null; $('orders').replaceChildren(); $('message').textContent=''; $('dashboard').hidden=true; $('logout').hidden=true; $('entry').hidden=false; $('open').focus(); });
