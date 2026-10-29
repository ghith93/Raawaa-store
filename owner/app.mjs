import { createOwnerClient } from './owner-client.mjs';
import { settings } from './settings.mjs';
const $ = id => document.getElementById(id);
let client = null;
try { if (settings && location.origin === settings.ownerOrigin) client = createOwnerClient(settings); } catch { /* configuration must fail closed */ }
if (!client) { $('unconfigured').hidden = false; $('login').disabled = true; }
const statusLabels = {pending_review:'بانتظار المراجعة',confirmed:'مؤكد',cancelled:'ملغي',fulfilled:'تم تجهيزه'};
const notificationLabels = {pending:'بانتظار الإرسال',sending:'جارٍ الإرسال',sent:'أُرسل إلى تيليغرام',failed:'فشل الإرسال',unknown:'حالة الإرسال غير مؤكدة'};
const scents = {unscented:'بلا عطر',vanilla:'فانيلا دافئة',rose:'ورد',oud:'عود شرقي',lavender:'لافندر',rosemary:'إكليل الجبل',jasmine:'ياسمين',ylang:'إيلانغ إيلانغ',mint:'نعناع'};
const oils = {argan:'أرجان',castor:'خروع',almond:'لوز حلو',jojoba:'جوجوبا',coconut:'جوز الهند',grapeseed:'بذور العنب'};
let cursor = null, busy = false, generation = 0, authenticated = false;
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

function closeSession(message = '') {
  generation++; busy=false; authenticated=false; cursor=null;
  $('pair-code').textContent=''; $('pair-copy').hidden=true; $('pair-status').textContent='';
  $('orders').replaceChildren(); $('message').textContent=''; $('more').hidden=true;
  $('dashboard').hidden=true; $('logout').hidden=true; $('entry').hidden=false;
  $('password').value=''; $('login').disabled=!client; $('login-message').textContent=message;
  if (client) void client.logout();
}
async function load(append=false) {
  if(busy || !authenticated) return;
  busy=true; const current=++generation;
  $('message').textContent='جارٍ تحميل الطلبات…'; $('more').disabled=true; $('refresh').disabled=true;
  try {
    const result=await client.list(append ? cursor : null);
    if(current!==generation || !authenticated) return;
    if(!append) $('orders').replaceChildren();
    for(const order of result.orders) $('orders').append(card(order));
    cursor=result.nextCursor || null; $('more').hidden=!cursor;
    $('message').textContent=$('orders').children.length ? '' : 'لا توجد طلبات بعد.';
  } catch (error) {
    if(current!==generation) return;
    if(error.message === 'SESSION_EXPIRED') { closeSession('انتهت الجلسة، يرجى تسجيل الدخول مجددًا.'); return; }
    $('message').textContent='تعذر تحميل الطلبات. حاول مجددًا.';
  } finally {
    if(current===generation) {busy=false; $('more').disabled=false; $('refresh').disabled=false;}
  }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if(!client || busy) return;
  busy=true; const current=++generation; $('login').disabled=true; $('login-message').textContent='جارٍ تسجيل الدخول…';
  const password=$('password').value; $('password').value='';
  try {
    await client.login($('email').value, password);
    if(current!==generation) return;
    authenticated=true; busy=false; $('entry').hidden=true; $('dashboard').hidden=false; $('logout').hidden=false;
    $('login-message').textContent=''; await load();
  } catch {
    if(current===generation) { busy=false; $('login').disabled=false; $('login-message').textContent='تعذر تسجيل الدخول. تحقق من البيانات أو حاول لاحقًا.'; }
  }
});
$('refresh').addEventListener('click',()=>load()); $('more').addEventListener('click',()=>load(true));
$('logout').addEventListener('click',()=>{closeSession(); $('email').focus();});
// Do not retain a live session or customer data in the browser back/forward cache.
window.addEventListener('pagehide',()=>closeSession());

let pairingBusy=false;
async function pairingAction(action) {
  if (!authenticated || pairingBusy) return;
  pairingBusy=true; const current=generation;
  $('pair-start').disabled=true; $('pair-finish').disabled=true;
  $('pair-status').textContent='جارٍ التحقق…';
  try {
    const result=await client.pair(action);
    if (current!==generation || !authenticated) return;
    if (action==='start') { $('pair-code').textContent=result.message; $('pair-copy').hidden=false; $('pair-status').textContent='انسخ الرسالة وأرسلها للبوت في محادثة خاصة، ثم اضغط تحقق.'; }
    else { $('pair-code').textContent=''; $('pair-copy').hidden=true; $('pair-status').textContent='تم ربط المحادثة. إرسال تنبيهات الطلبات لم يُفعّل بعد.'; }
  } catch (error) {
    if (current!==generation) return;
    if (error.message==='SESSION_EXPIRED') { closeSession('انتهت الجلسة، يرجى تسجيل الدخول مجددًا.'); return; }
    $('pair-status').textContent=error.message==='not_found' ? 'لم نجد رسالة الربط بعد. تأكد من إرسالها في المحادثة الخاصة ثم حاول مجددًا.' : error.message==='invalid' ? 'انتهى الرمز أو استُخدم. أنشئ رمزًا جديدًا.' : error.message==='ambiguous' ? 'تعذر تحديد المحادثة بأمان. أنشئ رمزًا جديدًا ولا تشاركه.' : 'تعذر الربط حاليًا. حاول مجددًا.';
  } finally { pairingBusy=false; $('pair-start').disabled=false; $('pair-finish').disabled=false; }
}
$('pair-start').addEventListener('click',()=>pairingAction('start'));
$('pair-finish').addEventListener('click',()=>pairingAction('finish'));
$('pair-copy').addEventListener('click',async()=>{ try { await navigator.clipboard.writeText($('pair-code').textContent); $('pair-status').textContent='نُسخت الرسالة. أرسلها للبوت ثم عد واضغط تحقق.'; } catch { $('pair-status').textContent='انسخ الرسالة الظاهرة يدويًا وأرسلها للبوت.'; } });

$('telegram-test').addEventListener('click',async()=>{
  if (!authenticated || pairingBusy) return;
  pairingBusy=true; const current=generation; $('telegram-test').disabled=true; $('pair-status').textContent='جارٍ إرسال رسالة الاختبار…';
  try {
    await client.sendTest(); if(current!==generation || !authenticated) return;
    $('pair-status').textContent='أُرسلت رسالة اختبار إلى تيليغرام. تأكد من وصولها؛ تنبيهات الطلبات لم تُفعّل بعد.';
  } catch(error) {
    if(current!==generation) return;
    if(error.message==='SESSION_EXPIRED'){closeSession('انتهت الجلسة، يرجى تسجيل الدخول مجددًا.');return;}
    $('pair-status').textContent=error.message==='TEST_UNKNOWN'?'تعذر تأكيد الإرسال. راجع تيليغرام قبل إعادة المحاولة.':'تعذر إرسال رسالة الاختبار. حاول لاحقًا.';
  } finally {pairingBusy=false; $('telegram-test').disabled=false;}
});
