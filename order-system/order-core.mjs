/** Pure order calculation. Server callers MUST supply trusted config, never client prices. */
const cents = n => Math.round(n * 100);

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
  const entries = input.items.map(item => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id)) throw new Error('INVALID_ITEM');
    seen.add(item.id);
    const product = config.products.find(p => p.id === item.id);
    if (!product || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > config.cart.maxQuantityPerItem) throw new Error('INVALID_ITEM');
    return { id: product.id, size: product.sizeLabel, qty: item.qty, unitCents: cents(product.price) };
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
  const subtotalCents = entries.reduce((n, item) => n + item.unitCents * item.qty, 0) + scentCents * quantity;
  const discountCents = Math.round(subtotalCents * method.discountPercent / 100);
  const deliveryCents = method.freeDeliveryIn.includes(zone.id) ? 0 : cents(zone.fee);
  return { name, phone, address, entries, scent, oil, zone: zone.id, method: method.id,
    subtotalCents, discountCents, deliveryCents, totalCents: subtotalCents - discountCents + deliveryCents,
    oilPricePending: Boolean(oil), status: 'pending_review' };
}

/** The default alert intentionally excludes customer name, phone and address. */
export function formatOwnerAlert(reference) {
  if (typeof reference !== 'string' || !/^[A-Z0-9-]{6,40}$/.test(reference)) throw new Error('INVALID_REFERENCE');
  return `طلب جديد بانتظار المراجعة: ${reference}\nافتحي لوحة الطلبات للاطلاع على التفاصيل.`;
}
