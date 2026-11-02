// Offline, deterministic hourly research simulator. No exchange access or orders.
export function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 3) throw new Error('يجب أن يحتوي الملف على صفين من البيانات على الأقل.');
  const header = lines[0].split(',').map(x => x.trim().toLowerCase());
  if (header.join(',') !== 'timestamp,price,funding_rate') throw new Error('الأعمدة المطلوبة بالترتيب: timestamp,price,funding_rate');
  const rows = lines.slice(1).map((line, i) => {
    const fields = line.split(',').map(x => x.trim());
    if (fields.length !== 3 || fields.some(x => !x)) throw new Error(`صف غير صالح: ${i + 2}`);
    const time = Date.parse(fields[0]), price = Number(fields[1]), funding = Number(fields[2]);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?Z$/.test(fields[0]) || !Number.isFinite(time) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(funding) || Math.abs(funding) > 0.04) throw new Error(`قيم غير صالحة في الصف ${i + 2}. استخدم UTC والسعر الموجب والتمويل العشري.`);
    return {time, price, funding};
  });
  for (let i = 1; i < rows.length; i++) if (rows[i].time - rows[i-1].time !== 3600000) throw new Error(`البيانات يجب أن تكون متتالية بفاصل ساعة تمامًا (الصف ${i + 2}).`);
  return rows;
}
export function demoRows() {
  const start = Date.UTC(2026, 0, 1); let price = 25;
  return Array.from({length: 168}, (_, i) => {
    price *= 1 + 0.0012 * Math.sin(i / 8) + 0.002 * Math.cos(i / 3) + (i > 100 && i < 114 ? 0.002 : 0);
    return { time: start + i * 3600000, price, funding: 0.00009 + 0.00009 * Math.sin(i / 13) };
  });
}
export function simulate(rows, options = {}) {
  const {capital = 300, notional = 30, entry = 0.0001, exit = 0.00005, stop = 0.02, fee = 0.00045, slippage = 0.0005} = options;
  if (![capital, notional, entry, exit, stop, fee, slippage].every(Number.isFinite) || capital <= 0 || notional <= 0 || notional > capital || entry <= exit || exit < 0 || stop <= 0 || stop >= 1 || fee < 0 || fee > 0.05 || slippage < 0 || slippage > 0.05 || rows.length < 2) throw new Error('إعدادات المحاكاة غير صالحة.');
  let cash = capital, position = null, fundingTotal = 0, fees = 0, trades = 0, peak = capital, maxDD = 0, stops = 0;
  const curve = [], events = [];
  const close = (r, reason) => {
    const fill = r.price * (1 + slippage), pnl = position.qty * (position.entry - fill), cost = position.qty * fill * fee;
    cash += pnl - cost; fees += cost; trades++; events.push({time:r.time, type:reason, price:fill, amount:pnl-cost}); position = null;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Row's funding was earned for the preceding hour, only by an already open position.
    if (position && i > 0) { const payment = position.qty * r.price * r.funding; cash += payment; fundingTotal += payment; }
    if (position && r.price >= position.entry * (1 + stop)) { close(r, 'وقف افتراضي'); stops++; }
    else if (position && i >= 2 && rows[i-1].funding < exit && rows[i-2].funding < exit) close(r, 'خروج بالإشارة');
    if (!position && i >= 2 && i < rows.length - 1 && rows[i-1].funding > entry && rows[i-2].funding > entry && cash >= notional) {
      const fill = r.price * (1 - slippage), qty = notional / fill, cost = notional * fee;
      cash -= cost; fees += cost; position = {entry:fill, qty}; trades++; events.push({time:r.time, type:'دخول افتراضي', price:fill, amount:-cost});
    }
    if (position && i === rows.length - 1) close(r, 'إغلاق نهاية البيانات');
    const equity = cash + (position ? position.qty * (position.entry - r.price) : 0);
    peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak-equity)/peak); curve.push({time:r.time, equity});
  }
  return {net:cash-capital, ending:cash, funding:fundingTotal, fees, trades, stops, maxDD, curve, events};
}
