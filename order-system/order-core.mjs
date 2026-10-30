/** Pure order calculation. Server callers MUST supply trusted config, never client prices. */
// نفس محرّك العروض الذي يعمل في المتصفح: الخادم يجب أن يحسب الرقم نفسه الذي رأته الزبونة.
// الملف لا يحمل أي قيمة بنفسه، ويُسقط نفسه إلى لا عرض إن كانت الخانات فارغة.
import '../js/offers.js';
const cents = n => Math.round(n * 100);
const offerEngine = globalThis.RawaaOffers || null;

export function prepareOrder(input, config) {
  if (!input || typeof input !== 'object' || !config) throw new Error('INVALID_ORDER');
  const clean = (value, max) => {
    if (typeof value !== 'string') throw new Error('INVALID_CONTACT');
    const text = value.trim();
    if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('INVALID_CONTACT');
    return text;
  };
  const name = clean(input.name, 80);
  const phone = clean(input.phone, 30);
  // Count digits rather than formatting characters; support Arabic-Indic digits
  // and common punctuation without claiming that the number is reachable.
  if (!/^\+?[0-9٠-٩ ()-]+$/.test(phone) || (phone.match(/[0-9٠-٩]/g) || []).length < 7) throw new Error('INVALID_PHONE');
  const address = clean(input.address, 200);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > config.products.length) throw new Error('INVALID_ITEMS');
  const seen = new Set();
  const offerState = offerEngine
    ? offerEngine.evaluate(config.offers, Object.fromEntries(config.products.map(p => [p.id, cents(p.price)])), offerEngine.todayISO())
    : { slots: [] };
  const entries = input.items.map(item => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id)) throw new Error('INVALID_ITEM');
    seen.add(item.id);
    const product = config.products.find(p => p.id === item.id);
    if (!product || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > config.cart.maxQuantityPerItem) throw new Error('INVALID_ITEM');
    const listCents = cents(product.price);
    const priced = offerEngine
      ? offerEngine.unitPrice(offerEngine.pick(offerState.slots, product.id), listCents)
      : { listCents, cents: listCents, cutCents: 0 };
    // عرض العبوة (عبوة/عبوتان/ثلاث) يُحسب بنفس محرّك المتصفح، على كمية هذا الحجم.
    const plan = offerEngine
      ? offerEngine.bestPlan(item.qty, priced.cents, offerEngine.bundlesFor(offerState.slots, product.id, listCents, config.offers))
      : { totalCents: priced.cents * item.qty, cutCents: 0 };
    return {
      id: product.id, size: product.sizeLabel, qty: item.qty,
      listCents, unitCents: priced.cents, offerCents: priced.cutCents * item.qty + plan.cutCents,
      lineCents: plan.totalCents
    };
  });
  const scent = input.scent || '';
  const oil = input.oil || '';
  if (typeof scent !== 'string' || (scent && !config.customization.scentOptions.some(o => o.id === scent))) throw new Error('INVALID_SCENT');
  if (typeof oil !== 'string' || (oil && !config.customization.oilAdditions.some(o => o.id === oil))) throw new Error('INVALID_OIL');
  // Free-text custom requests require a separately designed and validated field.
  if (scent === 'custom' || oil === 'other') throw new Error('CUSTOM_REQUIRES_CONTACT');
  const zone = config.delivery.zones.find(z => z.id === input.zone);
  const method = config.payment.methods.find(m => m.id === input.method && m.available !== false);
  if (!zone || !method) throw new Error('INVALID_DELIVERY');
  const quantity = entries.reduce((n, item) => n + item.qty, 0);
  const scentCents = scent && scent !== 'unscented' ? cents(config.customization.scentPrice) : 0;
  // العرض العام على قيمة المنتجات وحدها، ثم إضافة العطر، ثم خصم طريقة الدفع.
  const productCents = entries.reduce((n, item) => n + item.lineCents, 0);
  const generalSlot = offerEngine ? offerEngine.pick(offerState.slots, null) : null;
  const generalCut = generalSlot ? offerEngine.orderCut(generalSlot, productCents) : 0;
  const offerCents = entries.reduce((n, item) => n + item.offerCents, 0) + generalCut;
  const subtotalCents = productCents - generalCut + scentCents * quantity;
  const discountCents = Math.round(subtotalCents * method.discountPercent / 100);
  const deliveryCents = method.freeDeliveryIn.includes(zone.id) ? 0 : cents(zone.fee);
  return { name, phone, address, entries, scent, oil, zone: zone.id, method: method.id,
    subtotalCents, offerCents, discountCents, deliveryCents, totalCents: subtotalCents - discountCents + deliveryCents,
    oilPricePending: Boolean(oil), status: 'pending_review' };
}

/** The default alert intentionally excludes customer name, phone and address. */
export function formatOwnerAlert(reference) {
  if (typeof reference !== 'string' || !/^[A-Z0-9-]{6,40}$/.test(reference)) throw new Error('INVALID_REFERENCE');
  return `طلب جديد بانتظار المراجعة: ${reference}\nافتحي لوحة الطلبات للاطلاع على التفاصيل.`;
}
