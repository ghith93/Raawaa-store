/**
 * واجهة محرّر الأسعار — تربط owner/pricing-editor.mjs بالصفحة.
 *
 * كل الحكم (ما هو صالح، وكم ستدفع الزبونة، وما النص الجاهز) يعيش في
 * pricing-editor.mjs المُختبَر. هذا الملف عرض وإدخال فقط، وليس مكانًا لقاعدة
 * مالية جديدة — تجنّبًا لتكرار المعادلة في مكان خامس.
 */
import editor from './pricing-editor.mjs';

const CONFIG_URL = new URL('../js/config.js', import.meta.url).href;

const el = (id) => document.getElementById(id);
const money = (value) => '$' + (Math.round(value * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

let config = null;
let sourceText = '';
let draftPrices = {};
let draftOffers = [];
let draftAlwaysFree = true;
let draftDiscount = 10;

function clear(node) { node.textContent = ''; }
function showErrors(node, messages) {
  clear(node);
  messages.forEach((message) => {
    const line = document.createElement('div');
    line.textContent = '• ' + message;
    node.appendChild(line);
  });
}

/** يقرأ js/config.js من نفس الأصل وينفّذه في سياق معزول بلا صلاحيات. */
async function loadConfig() {
  const response = await fetch(CONFIG_URL, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('تعذّر تحميل الإعدادات (' + response.status + ')');
  sourceText = await response.text();
  // eval داخل دالة: نفس تقييم المتصفح للملف الثابت، بلا وصول إلى شبكة أو تخزين.
  const factory = new Function('window', sourceText + '\n;return window.RAWAA_CONFIG;');
  const loaded = factory({});
  if (!loaded || !Array.isArray(loaded.products)) throw new Error('ملف الإعدادات لا يحتوي منتجات');
  return loaded;
}

function renderPriceFields() {
  const box = el('price-fields');
  clear(box);
  config.products.forEach((product) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = product.sizeLabel;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0.01';
    input.step = '0.5';
    input.dir = 'ltr';
    input.value = String(draftPrices[product.id] ?? product.price);
    input.id = 'price-' + product.id;
    input.dataset.priceFor = product.id;
    input.addEventListener('input', () => {
      draftPrices[product.id] = input.value === '' ? '' : Number(input.value);
      refresh();
    });
    wrap.append(caption, input);
    box.appendChild(wrap);
  });
}

function renderZoneFields() {
  const box = el('zone-fields');
  clear(box);
  config.delivery.zones.forEach((zone) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = zone.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.5';
    input.dir = 'ltr';
    input.value = String(zone.fee);
    input.id = 'fee-' + zone.id;
    input.disabled = draftAlwaysFree;
    input.addEventListener('input', () => refresh());
    wrap.append(caption, input);
    box.appendChild(wrap);
  });
}

function renderOfferList() {
  const box = el('offer-list');
  clear(box);
  if (draftOffers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'لا عروض. الأسعار أعلاه هي المعروضة.';
    box.appendChild(empty);
    return;
  }
  draftOffers.forEach((offer, index) => {
    const row = document.createElement('div');
    row.className = 'offer-row';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = offer.label + (offer.enabled ? ' — مفعّل' : ' — غير مفعّل');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = offer.type + ' · ' + offer.value + (offer.endsAt ? ' · ينتهي ' + offer.endsAt : '');
    info.append(title, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'outline';
    remove.textContent = 'إزالة';
    remove.setAttribute('aria-label', 'إزالة العرض ' + offer.label);
    remove.addEventListener('click', () => {
      draftOffers.splice(index, 1);
      renderOfferList();
      refresh();
    });
    row.append(info, remove);
    box.appendChild(row);
  });
}

function renderImpact() {
  const table = el('impact');
  clear(table);
  const prices = validPriceObject();
  const rows = editor.priceMatrix(config, prices);
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['الحجم', 'المنطقة', 'الدفع', 'قبل الخصم', 'الخصم', 'التوصيل', 'الإجمالي'].forEach((label) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  const body = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const cells = [
      row.productLabel, row.zoneLabel, row.methodLabel,
      money(row.subtotal),
      row.discountCents ? '− ' + money(row.discountCents / 100) : '—',
      row.deliveryCents ? money(row.deliveryCents / 100) : 'مجاني',
      money(row.total)
    ];
    cells.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (index === 3 || index === 4 || index === 5 || index === 6) td.dir = 'ltr';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  table.append(head, body);
}

function validPriceObject() {
  const out = {};
  Object.keys(draftPrices).forEach((id) => {
    const value = Number(draftPrices[id]);
    if (Number.isFinite(value) && value > 0) out[id] = value;
  });
  return out;
}

function refresh() {
  const prices = validPriceObject();
  // نتحقق من المسودة الخام لا من النسخة المنقّاة: لو تحققنا بعد التنقية لما
  // ظهر أي خطأ أبدًا، ولظنّ المالك أن قيمة سالبة قُبلت وهي مُهمَلة بصمت.
  const priceCheck = editor.validatePrices(config.products, draftPrices);
  showErrors(el('price-errors'), priceCheck.errors);
  showErrors(el('price-warnings'), priceCheck.warnings);

  const policyErrors = [];
  if (!draftAlwaysFree) {
    config.delivery.zones.forEach((zone) => {
      const input = document.getElementById('fee-' + zone.id);
      const fee = Number(input ? input.value : zone.fee);
      policyErrors.push(...editor.validateDelivery({ zones: [{ ...zone, fee }], defaultZone: config.delivery.defaultZone }).errors);
    });
  }
  policyErrors.push(...editor.validateDiscount(draftDiscount).errors);
  showErrors(el('policy-errors'), policyErrors);

  renderImpact();
  renderSummaryAndOutput(prices);
}

function renderSummaryAndOutput(prices) {
  const changes = editor.summarizeChange(config, {
    prices,
    shamCashPercent: draftDiscount,
    alwaysFree: draftAlwaysFree,
    offers: draftOffers
  });
  const summary = el('summary');
  clear(summary);
  changes.forEach((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    summary.appendChild(item);
  });

  const out = el('output');
  const blocks = [];
  if (changes.length === 0) {
    out.textContent = '';
    return;
  }
  const { source: patched, applied } = editor.applyPricesToSource(sourceText, prices);
  if (applied.length) blocks.push('// الأسعار\n' + applied.map((a) => a.id + ': ' + a.from + ' → ' + a.to).join('\n'));
  if (draftOffers.length) blocks.push('// العروض (الصق داخل offers.slots)\n' + draftOffers.map((o) => editor.renderOfferLine(o)).join(',\n'));
  blocks.push('// السياسة\n' + 'delivery.policy.alwaysFree = ' + draftAlwaysFree + '\n' + 'shamcash.discountPercent = ' + draftDiscount);
  out.textContent = blocks.join('\n\n');
  // نحفظ أثر التعديل على المصدر للمراجعة، لا للكتابة التلقائية.
  out.dataset.patchedLength = String(patched.length);
}

function wireForms() {
  el('prices-form').addEventListener('submit', (event) => {
    event.preventDefault();
    refresh();
  });

  el('always-free').addEventListener('change', (event) => {
    draftAlwaysFree = event.target.checked;
    renderZoneFields();
    refresh();
  });

  el('discount-input').addEventListener('input', (event) => {
    draftDiscount = Number(event.target.value);
    refresh();
  });

  el('offer-size').addEventListener('change', () => {});
  el('offer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const candidate = {
      id: el('offer-id').value.trim(),
      label: el('offer-label').value.trim(),
      type: el('offer-type').value,
      value: Number(el('offer-value').value),
      sizeId: el('offer-size').value || undefined,
      qty: el('offer-type').value === 'bundle' ? Number(el('offer-qty').value) : undefined,
      endsAt: el('offer-ends').value || undefined,
      enabled: el('offer-enabled').checked
    };
    const check = editor.validateOffer(candidate, config.products, config.offers);
    if (check.errors.length) {
      showErrors(el('offer-errors'), check.errors);
      return;
    }
    showErrors(el('offer-errors'), []);
    draftOffers.push(candidate);
    el('offer-form').reset();
    renderOfferList();
    refresh();
  });
}

async function boot() {
  try {
    config = await loadConfig();
  } catch (error) {
    el('summary').textContent = '';
    const note = document.createElement('p');
    note.className = 'errors';
    note.textContent = 'تعذّر فتح المحرّر: ' + error.message;
    el('impact').replaceWith(note);
    return;
  }

  draftPrices = Object.fromEntries(config.products.map((p) => [p.id, p.price]));
  draftOffers = (config.offers.slots || []).map((slot) => ({ ...slot }));
  draftAlwaysFree = !(config.delivery.policy && config.delivery.policy.alwaysFree === false);
  draftDiscount = (config.payment.methods.find((m) => m.id === 'shamcash') || {}).discountPercent || 0;

  el('always-free').checked = draftAlwaysFree;
  el('discount-input').value = String(draftDiscount);

  config.products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = product.sizeLabel;
    el('offer-size').appendChild(option);
  });

  renderPriceFields();
  renderZoneFields();
  renderOfferList();
  wireForms();
  refresh();
}

boot();
