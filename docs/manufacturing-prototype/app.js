const $ = selector => document.querySelector(selector);
const escapeText = value => String(value ?? '');
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const dateLabel = value => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
const statusLabels = {
  DRAFT: 'مسودة', AI_CONCEPT: 'اقتراح محلي', SPEC_REVIEW: 'مراجعة المواصفة', FACTORY_REVIEW: 'مراجعة المصنع',
  SAMPLE_REQUIRED: 'العينة مطلوبة', APPROVED: 'معتمد تجريبيًا', PUBLISHED: 'منشور في متجر العرض',
  ORDER_CONFIRMED_DEMO: 'طلب تجريبي مؤكد · بلا دفع', PENDING_FACTORY_ACCEPTANCE: 'بانتظار قبول المصنع',
  ACCEPTED: 'مقبول تجريبيًا', IN_PRODUCTION: 'إنتاج تجريبي', QC_PENDING: 'بانتظار الجودة',
  REWORK_REQUIRED: 'إعادة عمل مطلوبة · الشحن محظور', QC_PASSED: 'اجتاز فحصًا اصطناعيًا',
  SHIPMENT_RECORDED_DEMO: 'شحنة يدوية مسجلة', HANDED_TO_CARRIER_DEMO: 'إقرار تسليم يدوي',
  DELIVERED_DEMO: 'تسليم تجريبي فقط', LABEL_CREATED: 'ملصق وهمي غير مرسل', HANDED_TO_CARRIER: 'إقرار تسليم يدوي',
  IN_TRANSIT: 'قيد النقل · إدخال يدوي', DELIVERED: 'تسليم مدخل يدويًا', EXCEPTION: 'استثناء تتبع', OPEN: 'مفتوحة', RESOLVED: 'مغلقة تجريبيًا'
};
const actionMeta = {
  GENERATE_CONCEPT: ['إنشاء اقتراح ثابت', 'نص محلي ثابت؛ لا يُستدعى مزود AI ولا تُنشأ صورة.'],
  CREATE_SPEC: ['إعداد إصدار للمراجعة', 'إنشاء مواصفة قرطاسية v1؛ قيمها توضيحية ولا تصلح للتصنيع.'],
  REQUEST_FACTORY_REVIEW: ['طلب عرض من المصنع التجريبي', 'يوجه السجل لمصنع A داخل الذاكرة فقط.'],
  SUBMIT_FACTORY_QUOTE: ['إرسال عرض اصطناعي', 'سعر وقدرة ومدة مختلقة؛ ليس التزام مورد.'],
  APPROVE_PRODUCT: ['اعتماد المنتج التجريبي', 'يتطلب مواصفة وعرضًا صالحين في النموذج.'],
  PUBLISH_PRODUCT: ['إتاحة في متجر المحاكاة', 'لن يُنشر شيء في متجر رواء العام.'],
  PLACE_TEST_ORDER: ['إنشاء طلب تجريبي', 'لا دفع ولا عنوان ولا بيانات مشتري حقيقية.'],
  CREATE_PRODUCTION_ORDER: ['إنشاء أمر التصنيع الوحيد', 'يثبت نسخة المواصفة من الطلب؛ لا يغادر الخادم.'],
  ACCEPT_WORK_ORDER: ['قبول الأمر', 'قبول المصنع التجريبي داخل النموذج فقط.'],
  START_PRODUCTION: ['تسجيل بدء الإنتاج', 'لا توجد مواد أو عملية إنتاج حقيقية.'],
  READY_FOR_QC: ['إرسال إلى فحص الجودة', 'لا توجد أدلة مصورة أو قياسات فعلية.'],
  RECORD_QC: ['تسجيل نتيجة اصطناعية', 'النجاح أو الفشل يحرك البوابة في المحاكاة فقط.'],
  COMPLETE_REWORK: ['تسجيل إعادة العمل', 'بعدها يلزم فحص الجودة مجددًا.'],
  CREATE_MANUAL_SHIPMENT: ['تسجيل شحنة يدوية', 'لا ملصق ولا ناقل حقيقي؛ لا يمكن تجاوز فشل الجودة.'],
  HANDOFF_TO_CARRIER: ['إقرار تسليم يدوي', 'لا يثبت تسليم الطرد فعليًا.'],
  UPDATE_TRACKING: ['تحديث تتبع يدوي', 'لا توجد API لشركة شحن.'],
  OPEN_CLAIM: ['فتح مطالبة تجريبية', 'استخدم سبب تأخير؛ لا توجد خدمة عملاء فعلية.'],
  RESOLVE_CLAIM: ['إغلاق المطالبة', 'تسجل ملاحظة اصطناعية قصيرة.']
};

let state = null;
let busy = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = escapeText(text);
  return node;
}
function setText(selector, text) { $(selector).textContent = escapeText(text); }
function showStatus(message, isError = false) {
  const box = $('#action-status');
  box.textContent = escapeText(message || '');
  box.classList.toggle('error', isError);
}
function listOrEmpty(container, items, emptyText) {
  container.replaceChildren();
  if (!items?.length) container.append(el('p', 'empty-state', emptyText));
}
async function getState() {
  const response = await fetch('/api/state', { headers: { accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'تعذر تحميل الحالة.');
  state = data;
  render();
}
async function choosePersona(personaId) {
  if (busy) return;
  busy = true;
  showStatus('جارٍ تبديل شخصية العرض…');
  try {
    const response = await fetch('/api/demo/persona', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'تعذر تبديل الشخصية.');
    await getState();
    showStatus('تم تبديل شخصية العرض. هذا ليس تسجيل دخول حقيقيًا.');
  } catch (error) { showStatus(error.message, true); }
  finally { busy = false; }
}
async function perform(action, payload = {}) {
  if (busy) return;
  busy = true;
  showStatus('جارٍ فحص صلاحية الإجراء وحالته في الخادم…');
  document.querySelectorAll('.action-button').forEach(button => { button.disabled = true; });
  try {
    const response = await fetch('/api/action', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ action, payload })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'رفض الخادم الإجراء.');
    state = result.state || state;
    render();
    showStatus(result.message || 'اكتمل الإجراء التجريبي.');
  } catch (error) {
    showStatus(error.message, true);
    try { await getState(); } catch { /* keep the actionable server error visible */ }
  } finally { busy = false; }
}

function setupPersona() {
  const select = $('#persona-select');
  select.replaceChildren();
  for (const persona of state.personas || []) {
    const option = document.createElement('option');
    option.value = persona.id;
    option.textContent = persona.label;
    option.selected = persona.id === state.actor.id;
    select.append(option);
  }
  select.onchange = () => choosePersona(select.value);
  $('#actor-card').replaceChildren(el('span', '', 'الدور الحالي: '), el('strong', '', `${state.actor.roleLabel} · تجريبي`));
}
function renderStats() {
  const product = state.product;
  const orderCount = state.orders?.length || 0;
  const workOrders = state.productionOrders || [];
  const quote = state.quote || product?.quote || null;
  const qcBlocked = workOrders.some(work => work.status === 'REWORK_REQUIRED');
  const items = [
    ['إصدار المواصفة', product?.activeVersion ? `v${product.activeVersion}` : (state.versions?.length ? `v${state.versions.length}` : 'لم يُنشأ'), 'نسخة محفوظة في الذاكرة فقط'],
    ['عرض المصنع', quote ? 'مسجل تجريبيًا' : (product?.status === 'PUBLISHED' || orderCount ? 'اعتمد ضمن المسار' : 'بانتظار المراجعة'), 'لا مصنع متصل'],
    ['الطلبات التجريبية', String(orderCount), 'مدفوعات محاكاة فقط'],
    ['بوابة الجودة', qcBlocked ? 'حظر الشحن' : (workOrders.some(work => work.status === 'QC_PASSED') ? 'اجتاز اصطناعيًا' : 'مطلوب قبل الشحن'), 'لا أدلة جودة حقيقية']
  ];
  const grid = $('#stats'); grid.replaceChildren();
  items.forEach(([label, value, note]) => {
    const card = el('div', 'stat-card');
    card.append(el('div', 'stat-label', label), el('div', 'stat-value', value), el('div', 'stat-note', note));
    grid.append(card);
  });
}
function renderProduct() {
  const product = state.product;
  const content = $('#product-content'); content.replaceChildren();
  if (!product) {
    $('#product-title').textContent = 'المنتج غير متاح لهذا الدور';
    $('#product-status').textContent = 'معزول';
    content.append(el('p', 'empty-state', 'لا توجد مواصفة أو تفاصيل منتج مكشوفة لهذه الشخصية. لا يوجد أمر مخصص لها.'));
    return;
  }
  $('#product-title').textContent = product.name || 'تفاصيل المنتج';
  $('#product-status').textContent = statusLabels[product.status] || product.status || 'غير محدد';
  const hero = el('div', 'product-hero');
  hero.append(el('div', 'product-art', 'رسم غير متاح\nبيانات اصطناعية'));
  const info = el('div');
  info.append(el('div', 'product-name', product.name || 'منتج تجريبي'), el('div', 'product-meta', `${product.category || 'قرطاسية'} · لا صورة ولا عينة حقيقية`));
  hero.append(info); content.append(hero);
  const cells = el('div', 'data-grid');
  const spec = product.spec || product.versions?.find(v => v.version === product.activeVersion)?.spec || null;
  const version = product.activeVersion || product.version || (state.versions?.length ? state.versions.at(-1).version : null);
  const details = [
    ['رقم الإصدار', version ? `v${version}` : 'لم يُنشأ'],
    ['حالة العينة', product.sampleStatus === 'APPROVED' ? 'معتمدة تجريبيًا' : (product.sampleRequired ? 'مطلوبة' : 'غير مطلوبة لهذا المسار التجريبي')]
  ];
  if (product.priceCents !== undefined) details.push(['سعر العرض', `${money(product.priceCents)} · تجريبي`]);
  if (product.quote?.unitCostCents !== undefined) details.push(['تكلفة المصنع التمثيلية', `${money(product.quote.unitCostCents)} · ليست عرضًا حقيقيًا`]);
  if (product.demoRetailPriceCents !== undefined) details.push(['سعر البيع التمثيلي', `${money(product.demoRetailPriceCents)} · ليس سعر رواء`]);
  for (const [label, value] of details) {
    const cell = el('div', 'data-cell'); cell.append(el('span', '', label), el('strong', '', value)); cells.append(cell);
  }
  content.append(cells);
  if (product.concept) {
    const box = el('div', 'spec-box');
    box.append(el('h3', '', 'اقتراح محلي غير معتمد من AI'));
    box.append(el('p', 'product-meta', product.concept.description || 'نص ثابت؛ لم يُستخدم نموذج ذكاء اصطناعي.'));
    content.append(box);
  }
  if (product.quote) {
    const quote = el('div', 'spec-box'); quote.append(el('h3', '', 'عرض اصطناعي فقط'));
    const lines = [
      ['الكمية الدنيا', product.quote.minimumQty], ['الطاقة المختلقة', product.quote.capacityQty],
      ['مدة افتراضية', `${product.quote.leadDays} أيام (غير ملزمة)`], ['صلاحية العرض', dateLabel(product.quote.validUntil)]
    ];
    quote.append(keyValueList(lines)); content.append(quote);
  }
  if (spec) content.append(renderSpec(spec));
  if (product.priceLabel) content.append(el('span', 'mock-label', product.priceLabel));
}
function keyValueList(lines) {
  const list = el('ul', 'spec-list');
  for (const [label, value] of lines) {
    const li = el('li'); li.append(el('span', '', label), el('strong', '', value)); list.append(li);
  }
  return list;
}
function renderSpec(spec) {
  const box = el('div', 'spec-box'); box.append(el('h3', '', 'مقتطف المواصفة التوضيحية'));
  const lines = [];
  const dim = typeof spec.dimensions === 'object' ? spec.dimensions?.target : spec.dimensions;
  if (dim) lines.push(['المقاس المستهدف', dim]);
  if (spec.materials?.length) lines.push(['الخامات', spec.materials.map(item => `${item.name}: ${item.value}`).join(' · ')]);
  if (spec.variants?.length) lines.push(['الخيارات', spec.variants.map(item => item.label).join('، ')]);
  if (spec.packaging?.value) lines.push(['التغليف', spec.packaging.value]);
  box.append(keyValueList(lines));
  if (spec.technicalFiles?.status === 'NOT_PROVIDED') box.append(el('p', 'product-meta', 'لا توجد ملفات CAD أو رسومات تنفيذية؛ لا تستخدم هذه البيانات للتصنيع.'));
  return box;
}

function findWork(statuses, predicate = () => true) {
  return (state.productionOrders || []).find(work => statuses.includes(work.status) && predicate(work));
}
function addAction(action, payload = {}, { label, hint, tone = '', disabled = false } = {}) {
  const meta = actionMeta[action] || [state.actions.find(item => item.action === action)?.label || action, 'إجراء تجريبي داخل الخادم المحلي.'];
  const item = el('div', 'action-item');
  const copy = el('div', 'action-copy'); copy.append(el('strong', '', label || meta[0]), el('span', '', hint || meta[1]));
  const button = el('button', `action-button ${tone}`.trim(), label || meta[0]);
  button.type = 'button'; button.disabled = disabled;
  button.addEventListener('click', () => perform(action, payload));
  item.append(copy, button); $('#actions').append(item);
}
function renderActions() {
  const host = $('#actions'); host.replaceChildren();
  const role = state.actor.role;
  const product = state.product;
  const orders = state.orders || [];
  const work = state.productionOrders || [];
  const shipments = state.shipments || [];
  const claims = state.claims || [];
  let count = 0;
  const allow = action => state.actions.some(item => item.action === action);
  const add = (action, payload, options) => { if (allow(action)) { addAction(action, payload, options); count++; } };

  if (role === 'designer') {
    if (product?.status === 'DRAFT') add('GENERATE_CONCEPT');
    if (product?.status === 'AI_CONCEPT') add('CREATE_SPEC');
  } else if (role === 'operations') {
    if (product?.status === 'SPEC_REVIEW') add('REQUEST_FACTORY_REVIEW');
    const unassigned = orders.find(order => !order.productionOrderId);
    if (unassigned) add('CREATE_PRODUCTION_ORDER', { orderId: unassigned.id, idempotencyKey: `production-${unassigned.id}` });
    const shippable = findWork(['QC_PASSED']);
    if (shippable) add('CREATE_MANUAL_SHIPMENT', { productionOrderId: shippable.id });
    const label = shipments.find(item => item.state === 'LABEL_CREATED');
    if (label) add('HANDOFF_TO_CARRIER', { shipmentId: label.id });
    const track = shipments.find(item => ['HANDED_TO_CARRIER', 'IN_TRANSIT', 'EXCEPTION'].includes(item.state));
    if (track) {
      const next = track.state === 'HANDED_TO_CARRIER' ? 'IN_TRANSIT' : (track.state === 'EXCEPTION' ? 'IN_TRANSIT' : 'DELIVERED');
      add('UPDATE_TRACKING', { shipmentId: track.id, state: next }, { label: `تسجيل الحالة التالية: ${statusLabels[next]}`, hint: 'تحديث يدوي اصطناعي؛ لا تتصل بشركة شحن.' });
      if (['HANDED_TO_CARRIER', 'IN_TRANSIT'].includes(track.state)) {
        add('UPDATE_TRACKING', { shipmentId: track.id, state: 'EXCEPTION' }, { label: 'محاكاة استثناء في التتبع', hint: 'فرع استثنائي يدوي؛ عالج الحالة ثم أعدها إلى قيد النقل.', tone: 'warn' });
      }
    }
  } else if (role === 'factory') {
    if (product?.status === 'FACTORY_REVIEW' && state.actor.factoryId === 'factory-north' && !state.quote) add('SUBMIT_FACTORY_QUOTE');
    const pending = findWork(['PENDING_FACTORY_ACCEPTANCE']);
    if (pending) add('ACCEPT_WORK_ORDER', { productionOrderId: pending.id });
    const accepted = findWork(['ACCEPTED']);
    if (accepted) add('START_PRODUCTION', { productionOrderId: accepted.id });
    const inProduction = findWork(['IN_PRODUCTION']);
    if (inProduction) add('READY_FOR_QC', { productionOrderId: inProduction.id });
    const rework = findWork(['REWORK_REQUIRED']);
    if (rework) add('COMPLETE_REWORK', { productionOrderId: rework.id });
  } else if (role === 'quality') {
    const pending = findWork(['QC_PENDING', 'REWORK_REQUIRED']);
    if (pending) {
      const checks = (product?.spec?.qualityChecks || state.versions?.find(v => v.version === product?.activeVersion)?.spec.qualityChecks || []).map(check => ({ id: check.id, result: 'PASS' }));
      if (checks.length) {
        add('RECORD_QC', { productionOrderId: pending.id, checks }, { label: 'تسجيل اجتياز اصطناعي', hint: 'يمرر كل بنود الفحص في المحاكاة؛ ليس دليلًا حقيقيًا.' });
        const failed = checks.map((check, index) => ({ ...check, result: index === 0 ? 'FAIL' : 'PASS' }));
        add('RECORD_QC', { productionOrderId: pending.id, checks: failed }, { label: 'محاكاة فشل بند · اختبار الحظر', hint: 'ينبغي أن تنتقل الحالة إلى إعادة العمل ويُمنع إنشاء الشحنة.', tone: 'warn' });
      }
    }
  } else if (role === 'customer') {
    if (product?.status === 'PUBLISHED' && !orders.length) add('PLACE_TEST_ORDER', { qty: 1, variant: product.variants?.[0]?.id || 'sage', idempotencyKey: 'customer-demo-order-v1' });
    const claimable = orders.find(order => !order.claimId);
    if (claimable) add('OPEN_CLAIM', { orderId: claimable.id, reason: 'DELAY', idempotencyKey: `delay-${claimable.id}` }, { label: 'فتح مطالبة بسبب تأخير', hint: 'حالة مطالبة تدريبية؛ لا ترسل رسالة أو طلبًا حقيقيًا.' });
  } else if (role === 'support') {
    const open = claims.find(claim => claim.status === 'OPEN');
    if (open) add('RESOLVE_CLAIM', { claimId: open.id, resolution: 'تمت مراجعة الحالة وإبلاغ العميل ضمن محاكاة التدريب.' });
  } else if (role === 'admin') {
    if (product?.status === 'FACTORY_REVIEW' && product.quote) add('APPROVE_PRODUCT');
    if (product?.status === 'APPROVED') add('PUBLISH_PRODUCT');
  }
  if (!count) host.append(el('p', 'empty-state', role === 'factory' && state.actor.factoryId === 'factory-east'
    ? 'عزل الخادم فعّال: لا مواصفة ولا عروض ولا أوامر تخص هذا المصنع التجريبي.'
    : 'لا يوجد إجراء متاح في هذه المرحلة لهذا الدور. اختر الدور المسؤول عن الخطوة التالية.'));
}

function stepStatus(done, current) { return done ? 'مكتمل في المحاكاة' : current ? 'الخطوة الحالية' : 'بانتظار السابق'; }
function renderJourney() {
  const product = state.product;
  const orders = state.orders || [];
  const work = state.productionOrders || [];
  const shipments = state.shipments || [];
  const version = product?.activeVersion || product?.version || orders.some(order => order.specVersion);
  const quoteDone = Boolean(state.quote || product?.quote || product?.status === 'APPROVED' || product?.status === 'PUBLISHED' || orders.length);
  const approved = ['APPROVED', 'PUBLISHED'].includes(product?.status) || orders.length > 0;
  const published = product?.status === 'PUBLISHED' || orders.length > 0;
  const orderCreated = orders.length > 0;
  const productionCreated = work.length > 0 || orders.some(order => order.productionOrderId);
  const factoryAdvanced = work.some(item => !['PENDING_FACTORY_ACCEPTANCE'].includes(item.status)) || shipments.length > 0;
  const qualityDone = work.some(item => ['QC_PASSED', 'SHIPMENT_RECORDED_DEMO', 'HANDED_TO_CARRIER_DEMO', 'DELIVERED_DEMO'].includes(item.status)) || shipments.length > 0;
  const shipmentDone = shipments.length > 0;
  const delivered = shipments.some(item => item.state === 'DELIVERED') || orders.some(item => item.status === 'DELIVERED_DEMO');
  const steps = [
    ['فكرة ومواصفة', Boolean(product?.concept || version), !product?.concept && !version && product?.status === 'DRAFT'],
    ['عرض ومراجعة المصنع', quoteDone, !quoteDone && product?.status === 'FACTORY_REVIEW'],
    ['اعتماد ونشر تجريبي', published, approved && !published],
    ['طلب ونسخة مثبتة', orderCreated, published && !orderCreated],
    ['أمر وقبول المصنع', factoryAdvanced, productionCreated && !factoryAdvanced],
    ['فحص الجودة', qualityDone, factoryAdvanced && !qualityDone],
    ['شحنة يدوية', shipmentDone, qualityDone && !shipmentDone],
    ['تتبع / تسليم', delivered, shipmentDone && !delivered]
  ];
  const list = $('#journey'); list.replaceChildren();
  steps.forEach(([label, done, current], index) => {
    const item = el('li', `journey-step${done ? ' done' : ''}${current ? ' current' : ''}`);
    item.append(el('span', 'step-num', `٠${index + 1}`), el('strong', '', label), el('span', 'step-state', stepStatus(done, current)));
    list.append(item);
  });
}
function renderOrders() {
  const host = $('#orders');
  listOrEmpty(host, state.orders || [], 'لا توجد طلبات في هذا الدور أو في المرحلة الحالية.');
  for (const order of state.orders || []) {
    const card = el('article', 'record-card');
    card.append(el('h3', '', `${order.reference} · ${statusLabels[order.status] || order.status}`));
    card.append(el('p', '', `الكمية: ${order.qty} · الإصدار المثبت: v${order.specVersion} · الخيار: ${order.variant?.label || '—'}`));
    if (order.itemSubtotalCents !== undefined) card.append(el('p', '', `إجمالي العرض: ${money(order.itemSubtotalCents)} · تجريبي`));
    if (order.payment) card.append(el('p', '', `الدفع: ${order.payment.status === 'NOT_CHARGED' ? 'لم يُخصم أي مبلغ' : order.payment.status} · محاكاة`));
    host.append(card);
  }
}
function renderProduction() {
  const host = $('#production-orders');
  listOrEmpty(host, state.productionOrders || [], 'لا يوجد أمر تصنيع بعد.');
  for (const item of state.productionOrders || []) {
    const card = el('article', 'record-card');
    card.append(el('h3', '', `${item.reference} · ${statusLabels[item.status] || item.status}`));
    card.append(el('p', '', `طلب ${item.orderReference} · مصنع تجريبي · كمية ${item.qty}`));
    card.append(el('p', '', `المواصفة المثبتة: v${item.specSnapshot?.specVersion || '—'} · ${item.specSnapshot?.productName || 'منتج تجريبي'}`));
    if (item.qc) {
      card.append(el('p', '', `نتيجة الجودة: ${item.qc.passed ? 'اجتاز اصطناعيًا' : 'فشل · إعادة عمل مطلوبة'}`));
      const checks = el('ul', 'spec-list');
      for (const check of item.qc.results || []) checks.append(el('li', '', `${check.id}: ${check.result === 'PASS' ? 'نجح (مصطنع)' : 'فشل'}`));
      card.append(checks);
    }
    if (item.quote?.unitCostCents !== undefined && ['operations', 'admin'].includes(state.actor.role)) card.append(el('p', '', `تكلفة الوحدة المسجلة: ${money(item.quote.unitCostCents)} · تجريبية`));
    host.append(card);
  }
}
function renderShippingClaims() {
  const host = $('#shipping-claims');
  const shipments = state.shipments || [];
  const claims = state.claims || [];
  const combined = shipments.length + claims.length;
  listOrEmpty(host, Array(combined).fill(true), 'لا توجد شحنات أو مطالبات بعد.');
  for (const shipment of shipments) {
    const card = el('article', 'record-card');
    card.append(el('h3', '', `${shipment.id} · ${statusLabels[shipment.state] || shipment.state}`));
    card.append(el('p', '', `${shipment.orderReference} · ${shipment.carrierLabel || 'ناقل يدوي'} · ${shipment.trackingReference || '—'}`));
    card.append(el('p', '', 'تتبع اصطناعي يدوي؛ لا توجد API أو شحنة فعلية.'));
    host.append(card);
  }
  for (const claim of claims) {
    const card = el('article', 'record-card');
    card.append(el('h3', '', `${claim.id} · ${statusLabels[claim.status] || claim.status}`));
    card.append(el('p', '', `${claim.orderReference} · السبب: ${claim.reason === 'DELAY' ? 'تأخير' : claim.reason}`));
    if (claim.resolution) card.append(el('p', '', `قرار تدريبي: ${claim.resolution}`));
    host.append(card);
  }
}
function renderTimeline() {
  const host = $('#activity');
  listOrEmpty(host, state.timeline || [], 'لا توجد أحداث ظاهرة لهذا الدور.');
  for (const item of state.timeline || []) {
    const row = el('li');
    row.append(el('strong', '', item.type.replaceAll('_', ' ')), el('time', '', dateLabel(item.at)));
    host.append(row);
  }
}
function render() {
  setupPersona(); renderStats(); renderProduct(); renderActions(); renderJourney();
  renderOrders(); renderProduction(); renderShippingClaims(); renderTimeline();
}

getState().catch(error => {
  $('#product-content').replaceChildren(el('p', 'empty-state', `تعذر الاتصال بخادم النموذج المحلي: ${error.message}`));
  showStatus('شغّل الخادم المحلي من التعليمات في README.', true);
});
