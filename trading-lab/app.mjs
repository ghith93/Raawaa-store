import {demoRows, parseCSV, simulate} from './engine.mjs';
const $ = id => document.getElementById(id);
let rows = demoRows();
const money = n => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const date = t => new Date(t).toISOString().slice(0,10);
function render() {
  const r = simulate(rows);
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
$('demo').addEventListener('click',()=>{rows=demoRows();$('source-title').textContent='بيانات توضيحية مولّدة';$('source-detail').textContent='168 ساعة · ليست أسعارًا حقيقية';$('source-badge').textContent='تجريبي';$('message').textContent='';$('csv').value='';render()});
$('csv').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('الحد الأقصى للملف 5 ميغابايت.');const parsed=parseCSV(await file.text());rows=parsed;$('source-title').textContent='بيانات CSV مرفوعة';$('source-detail').textContent=`${rows.length} ساعة · مصدرها المستخدم`; $('source-badge').textContent='ملف محلي';$('message').textContent='تم تحميل الملف محليًا، دون إرساله إلى أي خادم.';render()}catch(err){$('message').textContent=err.message;e.target.value=''}});
render();
