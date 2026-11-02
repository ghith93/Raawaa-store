import {demoRows, parseCSV, simulate} from './engine.mjs';
import {connectInfo, fetchHistory, hour} from './market.mjs';
const $ = id => document.getElementById(id);
let rows = demoRows();
let mode = 'demo';
const money = n => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const date = t => new Date(t).toISOString().slice(0,10);
function render() {
  const r = simulate(rows, {closeAtEnd:mode !== 'paper'});
  if (mode !== 'demo' && mode !== 'csv') { const stress=simulate(rows,{closeAtEnd:mode !== 'paper',fee:0.0009,slippage:0.001}); $('comparison').hidden=false; $('stress-result').textContent=`النتيجة الأساسية: ${money(r.net)} · مع مضاعفة التكاليف: ${money(stress.net)} · صفقات منفذة: ${r.trades} · رسوم: ${money(r.fees)} · ${r.open ? 'مركز افتراضي مفتوح' : 'لا مركز مفتوح'}`; } else $('comparison').hidden=true;
  $('net').textContent = money(r.net); $('ending').textContent = money(r.ending); $('drawdown').textContent = `${(r.maxDD*100).toFixed(2)}%`; $('funding').textContent = money(r.funding); $('chart-total').textContent = money(r.ending);
  $('start-date').textContent=date(rows[0].time); $('end-date').textContent=date(rows.at(-1).time);
  const values=r.curve.map(x=>x.equity), min=Math.min(...values), max=Math.max(...values), pad=Math.max((max-min)*0.15,0.1), low=min-pad, high=max+pad;
  $('chart-high').textContent=money(high); $('chart-mid').textContent=money((high+low)/2); $('chart-low').textContent=money(low);
  const points=values.map((v,i)=>`${(i/(values.length-1)*700).toFixed(2)},${(200-(v-low)/(high-low)*190).toFixed(2)}`).join(' ');
  $('chart').innerHTML=`<defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#a2d8af" stop-opacity=".35"/><stop offset="1" stop-color="#a2d8af" stop-opacity="0"/></linearGradient></defs><path d="M0 5H700 M0 100H700 M0 200H700" stroke="#edf2ee" stroke-dasharray="4 5"/><polygon points="0,210 ${points} 700,210" fill="url(#fade)"/><polyline points="${points}" fill="none" stroke="#78b68b" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`;
  $('event-count').textContent=`${r.events.length} عملية`;
  $('events').replaceChildren();
  if (!r.events.length) { $('events').textContent='لم تحدث عمليات وفق هذه الإعدادات.'; $('events').className='events empty'; }
  else { $('events').className='events'; [...r.events].reverse().slice(0,5).forEach(e=>{const el=document.createElement('div');el.className='event'; const icon=document.createElement('span');icon.className='event-dot';icon.textContent=e.type.startsWith('دخول')?'↗':'↙';const info=document.createElement('div');const title=document.createElement('strong');title.textContent=e.type;const sub=document.createElement('small');sub.textContent=`${new Date(e.time).toISOString().replace('T',' ').slice(0,16)} UTC · ${money(e.price)}`;info.append(title,sub);const val=document.createElement('span');val.className='event-value';val.textContent=money(e.amount);el.append(icon,info,val);$('events').append(el);}); }
}
$('run').addEventListener('click',()=>{render();$('message').textContent='تمت إعادة المحاكاة محليًا.'});
$('demo').addEventListener('click',()=>{rows=demoRows();mode='demo';$('source-title').textContent='بيانات توضيحية مولّدة';$('source-detail').textContent='168 ساعة · ليست أسعارًا حقيقية';$('source-badge').textContent='تجريبي';$('message').textContent='';$('csv').value='';render()});
$('csv').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('الحد الأقصى للملف 5 ميغابايت.');const parsed=parseCSV(await file.text());rows=parsed;mode='csv';$('source-title').textContent='بيانات CSV مرفوعة';$('source-detail').textContent=`${rows.length} ساعة · مصدرها المستخدم`; $('source-badge').textContent='ملف محلي';$('message').textContent='تم تحميل الملف محليًا، دون إرساله إلى أي خادم.';render()}catch(err){$('message').textContent=err.message;e.target.value=''}});
render();

const PAPER_KEY='madar-paper-hype-v1';
function getPaper(){try{const p=JSON.parse(localStorage.getItem(PAPER_KEY));return p && Number.isSafeInteger(p.start) && p.start%hour===0 ? p : null}catch{return null}}
function paperStatus(){const p=getPaper();$('paper-status').textContent=p?`تبدأ ${new Date(p.start).toISOString()} وتنتهي ${new Date(p.start+30*24*hour).toISOString()} · UTC. محفوظة في هذا المتصفح فقط. افتح الصفحة واضغط تحديث؛ لا تعمل في الخلفية.`:'التجربة لم تبدأ. تُحفظ بدايتها في هذا المتصفح فقط؛ لا تعمل في الخلفية.'}
paperStatus();
async function runMarket(task){let conn;const buttons=['quote','backtest','start-paper','refresh-paper'].map($);buttons.forEach(b=>b.disabled=true);try{ $('market-message').textContent='جارٍ الاتصال ببيانات Hyperliquid العامة…'; conn=await connectInfo();await task(conn.post); }catch(e){$('market-message').textContent=`تعذر جلب البيانات: ${e.message} لا توجد نتائج حقيقية جديدة؛ تحقق من الإنترنت وأعد المحاولة.`}finally{if(conn)conn.close();buttons.forEach(b=>b.disabled=false)}}
$('quote').addEventListener('click',()=>runMarket(async post=>{const mids=await post({type:'allMids'});const p=Number(mids?.HYPE);if(!Number.isFinite(p)||p<=0)throw new Error('لم يصل سعر HYPE صالح.');$('live-price').textContent=money(p);$('live-time').textContent=`تم الاستلام ${new Date().toISOString().slice(0,19).replace('T',' ')} UTC`; $('market-message').textContent='السعر منتصف السوق وقت الطلب، وقد يصبح قديمًا. اضغط تحديث لإعادة طلبه.';}));
async function loadReal(post,start,end,paper){if(end-start<2*hour)throw new Error('لا توجد ثلاث ساعات مكتملة بعد؛ عُد لاحقًا.');const data=await fetchHistory(post,start,end,(from,to)=>{$('market-message').textContent=`جلب البيانات التاريخية: ${new Date(from).toISOString().slice(0,10)} — ${new Date(to).toISOString().slice(0,10)}…`});rows=data;mode=paper?'paper':'backtest';$('source-title').textContent=paper?'تجربة ورقية على بيانات Hyperliquid':'باك تست على بيانات Hyperliquid';$('source-detail').textContent=`${rows.length} ساعة مكتملة · ${date(start)} — ${date(end)} UTC`;$('source-badge').textContent='بيانات حقيقية';$('market-message').textContent='الأسعار والتمويل تاريخيان؛ التنفيذ والوقف والرسوم والانزلاق محاكاة تقريبية، وليست صفقات حقيقية.';render()}
$('backtest').addEventListener('click',()=>runMarket(async post=>{const end=(Math.floor(Date.now()/hour)-1)*hour;await loadReal(post,end-(30*24-1)*hour,end,false)}));
$('start-paper').addEventListener('click',()=>{try{const current=getPaper();if(current && Date.now()<current.start+30*24*hour && !confirm('توجد تجربة جارية. هل تريد حذف بدايتها والبدء من جديد؟'))return; const start=(Math.floor(Date.now()/hour)+1)*hour;localStorage.setItem(PAPER_KEY,JSON.stringify({start}));paperStatus();$('market-message').textContent='بدأت التجربة اعتبارًا من الساعة UTC القادمة. اضغط تحديث التجربة بعد ثلاث ساعات مكتملة على الأقل.'}catch{$('market-message').textContent='تعذر حفظ التجربة في المتصفح. تحقق من إعدادات التخزين وعدم استخدام التصفح الخاص.'}});
$('refresh-paper').addEventListener('click',()=>{const p=getPaper();if(!p){$('market-message').textContent='ابدأ تجربة شهر أولًا.';return}runMarket(async post=>{const end=Math.min((Math.floor(Date.now()/hour)-1)*hour,p.start+30*24*hour-hour);await loadReal(post,p.start,end,true)})});
