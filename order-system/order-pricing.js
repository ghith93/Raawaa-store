/*
 * Shared pure pricing for the non-connected checkout preview and the order API.
 * The browser view is an estimate only; the server calls this again with trusted
 * config and never accepts a client-supplied total.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RawaaOrderPricing = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const cents = value => Math.round(Number(value) * 100);

  function calculateOrderEstimate(input, config, offersApi) {
    if (!input || typeof input !== 'object' || !config) throw new Error('INVALID_ORDER');
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > config.products.length) {
      throw new Error('INVALID_ITEMS');
    }

    const offers = offersApi === undefined ? (globalThis.RawaaOffers || null) : offersApi;
    const hasEnabledOffer = Array.isArray(config.offers?.slots) && config.offers.slots.some(offer => offer?.enabled === true);
    if (!offers && hasEnabledOffer) throw new Error('PRICING_UNAVAILABLE');
    const seen = new Set();
    const offerState = offers
      ? offers.evaluate(config.offers, Object.fromEntries(config.products.map(product => [product.id, cents(product.price)])), offers.todayISO())
      : { slots: [] };

    const entries = input.items.map(item => {
      if (!item || typeof item.id !== 'string' || seen.has(item.id)) throw new Error('INVALID_ITEM');
      seen.add(item.id);
      const product = config.products.find(candidate => candidate.id === item.id);
      if (!product || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > config.cart.maxQuantityPerItem) {
        throw new Error('INVALID_ITEM');
      }
      const listCents = cents(product.price);
      const priced = offers
        ? offers.unitPrice(offers.pick(offerState.slots, product.id), listCents)
        : { listCents, cents: listCents, cutCents: 0 };
      const plan = offers
        ? offers.bestPlan(item.qty, priced.cents, offers.bundlesFor(offerState.slots, product.id, listCents, config.offers))
        : { totalCents: priced.cents * item.qty, cutCents: 0 };
      return {
        id: product.id,
        size: product.sizeLabel,
        qty: item.qty,
        listCents,
        unitCents: priced.cents,
        offerCents: priced.cutCents * item.qty + plan.cutCents,
        lineCents: plan.totalCents
      };
    });

    const scent = input.scent || '';
    const oil = input.oil || '';
    if (typeof scent !== 'string' || (scent && !config.customization.scentOptions.some(option => option.id === scent))) {
      throw new Error('INVALID_SCENT');
    }
    if (typeof oil !== 'string' || (oil && !config.customization.oilAdditions.some(option => option.id === oil))) {
      throw new Error('INVALID_OIL');
    }
    if (scent === 'custom' || oil === 'other') throw new Error('CUSTOM_REQUIRES_CONTACT');

    const zone = config.delivery.zones.find(candidate => candidate.id === input.zone);
    const method = config.payment.methods.find(candidate => candidate.id === input.method && candidate.available !== false);
    if (!zone || !method) throw new Error('INVALID_DELIVERY');

    const quantity = entries.reduce((total, item) => total + item.qty, 0);
    const scentCents = scent && scent !== 'unscented' ? cents(config.customization.scentPrice) : 0;
    const productCents = entries.reduce((total, item) => total + item.lineCents, 0);
    const generalSlot = offers ? offers.pick(offerState.slots, null) : null;
    const generalCut = generalSlot ? offers.orderCut(generalSlot, productCents) : 0;
    const offerCents = entries.reduce((total, item) => total + item.offerCents, 0) + generalCut;
    const subtotalCents = productCents - generalCut + scentCents * quantity;
    const discountCents = Math.round(subtotalCents * method.discountPercent / 100);
    const deliveryCents = method.freeDeliveryIn.includes(zone.id) ? 0 : cents(zone.fee);

    return {
      entries,
      scent,
      oil,
      zone: zone.id,
      method: method.id,
      quantity,
      productCents: productCents - generalCut,
      scentCents: scentCents * quantity,
      subtotalCents,
      offerCents,
      discountCents,
      deliveryCents,
      totalCents: subtotalCents - discountCents + deliveryCents,
      oilPricePending: Boolean(oil)
    };
  }

  return Object.freeze({ calculateOrderEstimate });
}));
