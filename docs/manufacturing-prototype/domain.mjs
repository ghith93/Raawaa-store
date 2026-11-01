import { randomUUID } from 'node:crypto';

export const PERSONAS = Object.freeze([
  { id: 'owner', label: 'مسؤول المتجر', role: 'admin' },
  { id: 'designer', label: 'مصممة المنتجات', role: 'designer' },
  { id: 'operations', label: 'مسؤول العمليات', role: 'operations' },
  { id: 'quality', label: 'مسؤول الجودة', role: 'quality' },
  { id: 'factory-north', label: 'المصنع التجريبي A', role: 'factory', factoryId: 'factory-north' },
  { id: 'factory-east', label: 'المصنع التجريبي B (اختبار العزل)', role: 'factory', factoryId: 'factory-east' },
  { id: 'support', label: 'الدعم', role: 'support' },
  { id: 'finance', label: 'المالية', role: 'finance' },
  { id: 'customer-demo', label: 'عميل تجريبي', role: 'customer', customerId: 'customer-demo' }
]);

export const ROLE_LABELS = Object.freeze({
  admin: 'مسؤول المتجر', designer: 'مصمم المنتجات', operations: 'العمليات',
  quality: 'الجودة', factory: 'المصنع', support: 'الدعم', finance: 'المالية', customer: 'العميل'
});

const ACTION_ROLES = Object.freeze({
  GENERATE_CONCEPT: ['designer'],
  CREATE_SPEC: ['designer'],
  REQUEST_FACTORY_REVIEW: ['operations'],
  SUBMIT_FACTORY_QUOTE: ['factory'],
  APPROVE_PRODUCT: ['admin'],
  APPROVE_SAMPLE: ['quality'],
  PUBLISH_PRODUCT: ['admin'],
  PLACE_TEST_ORDER: ['customer'],
  CREATE_PRODUCTION_ORDER: ['operations'],
  ACCEPT_WORK_ORDER: ['factory'],
  START_PRODUCTION: ['factory'],
  READY_FOR_QC: ['factory'],
  RECORD_QC: ['quality'],
  COMPLETE_REWORK: ['factory'],
  CREATE_MANUAL_SHIPMENT: ['operations'],
  HANDOFF_TO_CARRIER: ['operations'],
  UPDATE_TRACKING: ['operations'],
  OPEN_CLAIM: ['customer'],
  RESOLVE_CLAIM: ['support']
});

const ACTION_LABELS = Object.freeze({
  GENERATE_CONCEPT: 'توليد اقتراح محلي', CREATE_SPEC: 'إنشاء مواصفة للمراجعة',
  REQUEST_FACTORY_REVIEW: 'طلب مراجعة المصنع', SUBMIT_FACTORY_QUOTE: 'إرسال عرض مصنع تجريبي',
  APPROVE_PRODUCT: 'اعتماد المواصفة والعرض', APPROVE_SAMPLE: 'اعتماد العينة',
  PUBLISH_PRODUCT: 'نشر المنتج في متجر العرض', PLACE_TEST_ORDER: 'إنشاء طلب شراء تجريبي',
  CREATE_PRODUCTION_ORDER: 'إنشاء أمر تصنيع', ACCEPT_WORK_ORDER: 'قبول أمر التصنيع',
  START_PRODUCTION: 'بدء الإنتاج التجريبي', READY_FOR_QC: 'إرسال إلى فحص الجودة',
  RECORD_QC: 'تسجيل نتيجة الجودة', COMPLETE_REWORK: 'إنهاء إعادة العمل التجريبية',
  CREATE_MANUAL_SHIPMENT: 'تسجيل شحنة يدوية تجريبية', HANDOFF_TO_CARRIER: 'تسجيل تسليم للناقل',
  UPDATE_TRACKING: 'تحديث تتبع تجريبي', OPEN_CLAIM: 'فتح مطالبة تجريبية', RESOLVE_CLAIM: 'إغلاق المطالبة التجريبية'
});

const ROLE_ACTIONS = Object.freeze({
  admin: ['APPROVE_PRODUCT', 'PUBLISH_PRODUCT'],
  designer: ['GENERATE_CONCEPT', 'CREATE_SPEC'],
  operations: ['REQUEST_FACTORY_REVIEW', 'CREATE_PRODUCTION_ORDER', 'CREATE_MANUAL_SHIPMENT', 'HANDOFF_TO_CARRIER', 'UPDATE_TRACKING'],
  factory: ['SUBMIT_FACTORY_QUOTE', 'ACCEPT_WORK_ORDER', 'START_PRODUCTION', 'READY_FOR_QC', 'COMPLETE_REWORK'],
  quality: ['APPROVE_SAMPLE', 'RECORD_QC'],
  support: ['RESOLVE_CLAIM'],
  finance: [],
  customer: ['PLACE_TEST_ORDER', 'OPEN_CLAIM']
});

const PRODUCT_ID = 'demo-notebook-a5';
const STAGES = Object.freeze({
  DRAFT: 'مسودة', AI_CONCEPT: 'مفهوم تجريبي', SPEC_REVIEW: 'مراجعة المواصفة',
  FACTORY_REVIEW: 'مراجعة المصنع', SAMPLE_REQUIRED: 'العينة مطلوبة', APPROVED: 'معتمد تجريبيًا',
  PUBLISHED: 'منشور في المتجر التجريبي', PAUSED: 'متوقف', ARCHIVED: 'مؤرشف'
});

function clone(value) { return structuredClone(value); }
function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}
function cents(amount) { return Math.round(Number(amount) * 100); }
function isValidActor(actor) {
  return Boolean(actor && PERSONAS.some(persona => persona.id === actor.id && persona.role === actor.role
    && (persona.factoryId || null) === (actor.factoryId || null)
    && (persona.customerId || null) === (actor.customerId || null)));
}
function actorFor(personaId) { return PERSONAS.find(persona => persona.id === personaId) || null; }

export function createManufacturingDomain({ idFactory = randomUUID, now = () => new Date() } = {}) {
  let product = {
    id: PRODUCT_ID,
    name: 'دفتر ملاحظات A5 — بيانات صناعية تجريبية',
    category: 'قرطاسية غير منظمة',
    status: 'DRAFT',
    demoOnly: true,
    concept: null,
    versions: [],
    activeVersion: null,
    factoryId: 'factory-north',
    quote: null,
    sampleRequired: false,
    sampleStatus: 'NOT_REQUIRED_FOR_DEMO',
    approval: null,
    publishedAt: null,
    demoRetailPriceCents: 2400,
    demoPriceLabel: 'سعر سيناريو تجريبي فقط — ليس سعر بيع رواء'
  };
  const orders = [];
  const productionOrders = [];
  const shipments = [];
  const claims = [];
  const events = [];
  const idempotency = new Map();
  const sequence = { order: 0, production: 0, shipment: 0, claim: 0 };

  function stamp() { return now().toISOString(); }
  function event(type, actor, details = {}) {
    events.unshift({ id: idFactory(), type, actor: actor.id, role: actor.role, at: stamp(), details: clone(details) });
    if (events.length > 100) events.length = 100;
  }
  function fail(code, message, status = 409) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    throw error;
  }
  function requireRole(actor, action) {
    if (!isValidActor(actor)) fail('INVALID_DEMO_ACTOR', 'Persona de demo غير صالحة.', 401);
    if (!ROLE_ACTIONS[actor.role]?.includes(action)) fail('FORBIDDEN', 'هذا الإجراء غير متاح لهذا الدور.', 403);
    if (actor.role === 'admin' && actor.id !== 'owner') fail('FORBIDDEN', 'المسؤول التجريبي غير معتمد.', 403);
  }
  function requireProductStatus(status) {
    if (product.status !== status) fail('INVALID_TRANSITION', `الإجراء يتطلب حالة ${STAGES[status] || status}.`);
  }
  function requireProduction(id, actor) {
    const work = productionOrders.find(item => item.id === id);
    if (!work) fail('NOT_FOUND', 'أمر التصنيع غير موجود.', 404);
    if (actor.role === 'factory' && work.factoryId !== actor.factoryId) fail('FORBIDDEN', 'لا يملك هذا المصنع أمر التصنيع.', 403);
    return work;
  }
  function requireOrder(id, actor) {
    const order = orders.find(item => item.id === id);
    if (!order) fail('NOT_FOUND', 'الطلب غير موجود.', 404);
    if (actor.role === 'customer' && order.customerId !== actor.customerId) fail('FORBIDDEN', 'هذا الطلب لا يخص حساب العرض الحالي.', 403);
    return order;
  }
  function latestVersion() {
    return product.versions.find(version => version.version === product.activeVersion) || null;
  }
  function normalizedCustomerOrder(order, role) {
    if (role === 'admin' || role === 'support' || role === 'customer') return {
      id: order.id, reference: order.reference, status: order.status, qty: order.qty,
      variant: order.variant, itemSubtotalCents: order.itemSubtotalCents,
      payment: clone(order.payment), createdAt: order.createdAt,
      specVersion: order.snapshot.specVersion, productionOrderId: order.productionOrderId,
      shipmentId: order.shipmentId, claimId: order.claimId
    };
    if (role === 'operations' || role === 'finance') return {
      id: order.id, reference: order.reference, status: order.status, qty: order.qty,
      itemSubtotalCents: order.itemSubtotalCents, payment: clone(order.payment),
      createdAt: order.createdAt, specVersion: order.snapshot.specVersion,
      productionOrderId: order.productionOrderId, shipmentId: order.shipmentId
    };
    return null;
  }
  function normalizedProduction(work, role) {
    const specSnapshot = clone(work.specSnapshot);
    if (!['admin', 'operations'].includes(role)) delete specSnapshot.retailPriceCents;
    if (role === 'quality') delete specSnapshot.quoteUnitCostCents;
    const common = {
      id: work.id, reference: work.reference, orderReference: work.orderReference,
      status: work.status, factoryId: work.factoryId, qty: work.qty,
      specSnapshot, dueDate: work.dueDate,
      events: clone(work.events), qc: clone(work.qc), shipmentId: work.shipmentId
    };
    if (role === 'factory') return { ...common, notes: work.factoryNotes };
    if (role === 'quality') return common;
    if (role === 'admin' || role === 'operations') return { ...common, quote: clone(work.quote) };
    return null;
  }

  function productViewFor(actor) {
    const role = actor.role;
    if (role === 'admin' || role === 'operations') return clone(product);
    if (role === 'factory') {
      if (actor.factoryId !== product.factoryId) return null;
      return {
        id: product.id, name: product.name, category: product.category, status: product.status,
        demoOnly: product.demoOnly, activeVersion: product.activeVersion,
        spec: clone(latestVersion()?.spec || null), quote: product.quote ? {
          id: product.quote.id, feasible: product.quote.feasible, unitCostCents: product.quote.unitCostCents,
          currency: product.quote.currency, minimumQty: product.quote.minimumQty,
          capacityQty: product.quote.capacityQty, leadDays: product.quote.leadDays,
          sampleRequired: product.quote.sampleRequired, synthetic: true
        } : null
      };
    }
    if (role === 'designer') return {
      id: product.id, name: product.name, category: product.category, status: product.status,
      demoOnly: product.demoOnly, concept: clone(product.concept), activeVersion: product.activeVersion,
      versions: clone(product.versions)
    };
    if (role === 'quality') return {
      id: product.id, name: product.name, category: product.category, status: product.status,
      demoOnly: product.demoOnly, activeVersion: product.activeVersion,
      spec: clone(latestVersion()?.spec || null), sampleRequired: product.sampleRequired,
      sampleStatus: product.sampleStatus
    };
    return { id: product.id, name: product.name, category: product.category, status: product.status, demoOnly: product.demoOnly };
  }

  function view(actor) {
    if (!isValidActor(actor)) fail('INVALID_DEMO_ACTOR', 'Persona de demo غير صالحة.', 401);
    const role = actor.role;
    const base = {
      prototype: {
        localOnly: true,
        dataMode: 'synthetic-in-memory',
        aiProvider: 'mock',
        paymentProvider: 'mock',
        shippingProvider: 'manual-demo',
        warning: 'نموذج محلي ببيانات اصطناعية. مبدّل الأدوار لا يمثل تسجيل دخول. لا ينفذ AI أو دفعًا أو تصنيعًا أو شحنًا حقيقيًا.'
      },
      actor: { id: actor.id, role, roleLabel: ROLE_LABELS[role], factoryId: actor.factoryId || null },
      personas: PERSONAS.map(({ id, label, role: personaRole, factoryId }) => ({ id, label, role: personaRole, factoryId: factoryId || null })),
      product: productViewFor(actor),
      actions: (ROLE_ACTIONS[role] || []).map(action => ({ action, label: ACTION_LABELS[action] })),
      timeline: clone(events).filter(item => role === 'admin' || role === 'designer' || role === 'operations' || role === 'finance' || item.actor === actor.id || (role === 'factory' && item.details.factoryId === actor.factoryId)).slice(0, 40)
    };

    if (role === 'admin') {
      return {
        ...base,
        orders: orders.map(order => normalizedCustomerOrder(order, role)),
        productionOrders: productionOrders.map(work => normalizedProduction(work, role)),
        shipments: clone(shipments), claims: clone(claims),
        factories: [
          { id: 'factory-north', name: 'مصنع تجريبي شمالي', synthetic: true, quote: product.quote ? clone(product.quote) : null },
          { id: 'factory-east', name: 'مصنع تجريبي شرقي', synthetic: true, quote: null }
        ]
      };
    }
    if (role === 'designer') return { ...base, versions: clone(product.versions) };
    if (role === 'operations') return {
      ...base,
      orders: orders.map(order => normalizedCustomerOrder(order, role)),
      productionOrders: productionOrders.map(work => normalizedProduction(work, role)),
      shipments: clone(shipments)
    };
    if (role === 'factory') return {
      ...base,
      productionOrders: productionOrders.filter(work => work.factoryId === actor.factoryId).map(work => normalizedProduction(work, role)),
      quote: actor.factoryId === product.factoryId ? clone(product.quote) : null
    };
    if (role === 'quality') return { ...base, productionOrders: productionOrders.map(work => normalizedProduction(work, role)) };
    if (role === 'finance') return {
      ...base,
      quote: product.quote ? { factoryId: product.quote.factoryId, unitCostCents: product.quote.unitCostCents, currency: product.quote.currency, validUntil: product.quote.validUntil, synthetic: true } : null,
      orders: orders.map(order => normalizedCustomerOrder(order, role))
    };
    if (role === 'support') return {
      ...base,
      orders: orders.map(order => normalizedCustomerOrder(order, role)),
      shipments: shipments.map(({ id, orderReference, state, carrierLabel, trackingReference, events: shipmentEvents }) => ({ id, orderReference, state, carrierLabel, trackingReference, events: shipmentEvents })),
      claims: clone(claims)
    };
    return {
      ...base,
      product: product.status === 'PUBLISHED' ? {
        id: product.id, name: product.name, category: product.category, status: product.status,
        demoOnly: true, version: latestVersion()?.version || null,
        variants: latestVersion()?.spec.variants || [], priceCents: product.demoRetailPriceCents,
        priceLabel: product.demoPriceLabel
      } : null,
      orders: orders.filter(order => order.customerId === actor.customerId).map(order => normalizedCustomerOrder(order, role)),
      shipments: shipments.filter(shipment => orders.find(order => order.id === shipment.orderId)?.customerId === actor.customerId)
        .map(({ id, orderReference, state, carrierLabel, trackingReference, events: shipmentEvents }) => ({ id, orderReference, state, carrierLabel, trackingReference, events: shipmentEvents }))
    };
  }

  function perform(actor, action, payload = {}) {
    requireRole(actor, action);
    const nowISO = stamp();
    switch (action) {
      case 'GENERATE_CONCEPT': {
        requireProductStatus('DRAFT');
        product.concept = {
          source: 'MOCK_PROVIDER',
          model: null,
          generatedAt: nowISO,
          title: 'دفتر A5 بواجهة هادئة وورق تدوير — اقتراح تجريبي ثابت',
          description: 'اقتراح نصي محلي فقط؛ لم يُستدعَ نموذج أو مولّد صور ولم تُنشأ أصول بصرية.',
          suggestions: [
            { key: 'paper', value: 'ورق تدوير 90 gsm', provenance: 'AI_SUGGESTION_UNVERIFIED' },
            { key: 'size', value: 'A5 — 148 × 210 مم', provenance: 'AI_SUGGESTION_UNVERIFIED' },
            { key: 'cover', value: 'غلاف كرتوني بلون أخضر مريمي', provenance: 'AI_SUGGESTION_UNVERIFIED' }
          ]
        };
        product.status = 'AI_CONCEPT';
        event('CONCEPT_MOCK_GENERATED', actor, { productId: product.id, provider: 'MOCK_PROVIDER' });
        return { message: 'تم إنشاء اقتراح محلي ثابت، وليس استدعاء ذكاء اصطناعي حقيقيًا.', state: view(actor) };
      }
      case 'CREATE_SPEC': {
        requireProductStatus('AI_CONCEPT');
        const version = {
          version: product.versions.length + 1,
          createdAt: nowISO,
          createdBy: actor.id,
          status: 'SPEC_REVIEW',
          spec: {
            category: 'stationery',
            materials: [
              { name: 'ورق تدوير', value: '90 gsm', provenance: 'HUMAN_REVIEWED_DEMO' },
              { name: 'غلاف كرتوني', value: '300 gsm', provenance: 'HUMAN_REVIEWED_DEMO' }
            ],
            dimensions: { target: 'A5 — 148 × 210 مم', tolerance: '±2 مم', provenance: 'HUMAN_REVIEWED_DEMO' },
            construction: { value: 'تجليد بسيط بغلاف كرتوني', provenance: 'HUMAN_REVIEWED_DEMO' },
            variants: [
              { id: 'sage', label: 'أخضر مريمي', provenance: 'HUMAN_REVIEWED_DEMO' },
              { id: 'sand', label: 'رملي', provenance: 'HUMAN_REVIEWED_DEMO' }
            ],
            packaging: { value: 'غلاف ورقي واقٍ', provenance: 'HUMAN_REVIEWED_DEMO' },
            bom: [
              { item: 'ورق داخلي', quantity: '80 ورقة', provenance: 'HUMAN_REVIEWED_DEMO' },
              { item: 'غلاف كرتوني', quantity: 'قطعة واحدة', provenance: 'HUMAN_REVIEWED_DEMO' }
            ],
            qualityChecks: [
              { id: 'dimensions', target: 'A5 ضمن ±2 مم', critical: true },
              { id: 'page-count', target: '80 ورقة ضمن ±2', critical: true },
              { id: 'binding', target: 'الغلاف متصل ولا تنفصل الأوراق عند الفتح التجريبي', critical: true },
              { id: 'print', target: 'لا لطخات أو قص غير مقصود في منطقة الطباعة', critical: true }
            ],
            sample: { required: false, reason: 'مسار قرطاسية تجريبي غير حرج؛ لا يعمم على منتجات رواء أو منتجات منظمة.' },
            technicalFiles: { status: 'NOT_PROVIDED', note: 'لا توجد ملفات CAD أو مخططات تنفيذية؛ لا تستخدم هذه المواصفة للتصنيع الحقيقي.' }
          }
        };
        product.versions.push(version);
        product.activeVersion = version.version;
        product.status = 'SPEC_REVIEW';
        event('SPEC_VERSION_CREATED', actor, { productId: product.id, version: version.version, source: 'HUMAN_REVIEWED_DEMO' });
        return { message: `أُنشئت المواصفة التجريبية v${version.version} للمراجعة.`, state: view(actor) };
      }
      case 'REQUEST_FACTORY_REVIEW': {
        requireProductStatus('SPEC_REVIEW');
        if (!latestVersion()) fail('SPEC_REQUIRED', 'لا توجد نسخة مواصفة للمراجعة.');
        product.factoryId = 'factory-north';
        product.status = 'FACTORY_REVIEW';
        event('FACTORY_REVIEW_REQUESTED', actor, { productId: product.id, specVersion: product.activeVersion, factoryId: product.factoryId });
        return { message: 'أُنشئ طلب عرض سعر تجريبي. لم يُرسل إلى مصنع حقيقي.', state: view(actor) };
      }
      case 'SUBMIT_FACTORY_QUOTE': {
        requireProductStatus('FACTORY_REVIEW');
        if (actor.factoryId !== product.factoryId) fail('FORBIDDEN', 'هذا المصنع غير مكلّف بالمراجعة.', 403);
        const quoteId = `QUOTE-DEMO-${idFactory().slice(0, 8).toUpperCase()}`;
        product.quote = {
          id: quoteId,
          factoryId: actor.factoryId,
          feasible: true,
          unitCostCents: cents(7),
          currency: 'USD',
          minimumQty: 1,
          capacityQty: 50,
          leadDays: 4,
          validUntil: new Date(now().getTime() + 7 * 86400000).toISOString(),
          sampleRequired: false,
          sampleStatus: 'NOT_REQUIRED_FOR_DEMO',
          notes: 'عرض سعر اصطناعي محلي؛ ليس عرض مورد ولا وعد مدة.',
          synthetic: true
        };
        product.sampleRequired = false;
        product.sampleStatus = 'NOT_REQUIRED_FOR_DEMO';
        event('FACTORY_QUOTE_MOCKED', actor, { productId: product.id, factoryId: actor.factoryId, quoteId });
        return { message: 'سُجل عرض سعر تجريبي محلي. لم يتواصل النظام مع مصنع.', state: view(actor) };
      }
      case 'APPROVE_PRODUCT': {
        if (product.status !== 'FACTORY_REVIEW' && product.status !== 'SAMPLE_REQUIRED') fail('INVALID_TRANSITION', 'المنتج ليس في مرحلة اعتماد المصنع/العينة.');
        const version = latestVersion();
        const required = version && version.spec && ['materials', 'dimensions', 'construction', 'variants', 'packaging', 'bom', 'qualityChecks']
          .every(key => Array.isArray(version.spec[key]) ? version.spec[key].length > 0 : Boolean(version.spec[key]));
        const quoteValid = product.quote && product.quote.feasible && Date.parse(product.quote.validUntil) > now().getTime();
        if (!required || !quoteValid) fail('APPROVAL_GATE', 'يلزم اكتمال المواصفة وعرض مصنع صالح قبل الاعتماد.');
        if (product.sampleRequired && product.sampleStatus !== 'APPROVED') fail('SAMPLE_REQUIRED', 'لا يمكن الاعتماد قبل اجتياز مراجعة العينة.');
        product.status = 'APPROVED';
        product.approval = { approvedBy: actor.id, approvedAt: nowISO, specVersion: version.version, quoteId: product.quote.id };
        event('PRODUCT_APPROVED', actor, { productId: product.id, version: version.version, quoteId: product.quote.id });
        return { message: 'اعتمد المسؤول المواصفة والعرض التجريبيين.', state: view(actor) };
      }
      case 'APPROVE_SAMPLE': {
        if (product.status !== 'SAMPLE_REQUIRED' || !product.sampleRequired) fail('INVALID_TRANSITION', 'لا توجد عينة مطلوبة للاعتماد.');
        if (payload.approved !== true) fail('SAMPLE_REVIEW_REQUIRED', 'ارفض العينة مع سبب عبر استثناء تشغيلي؛ لا يمكن اعتمادها بهذا الإجراء.');
        product.sampleStatus = 'APPROVED';
        product.status = 'FACTORY_REVIEW';
        event('SAMPLE_APPROVED', actor, { productId: product.id, specVersion: product.activeVersion });
        return { message: 'اعتمد مسؤول الجودة العينة التجريبية.', state: view(actor) };
      }
      case 'PUBLISH_PRODUCT': {
        requireProductStatus('APPROVED');
        product.status = 'PUBLISHED';
        product.publishedAt = nowISO;
        event('PRODUCT_PUBLISHED_DEMO', actor, { productId: product.id, specVersion: product.activeVersion });
        return { message: 'نُشر المنتج في متجر المحاكاة فقط.', state: view(actor) };
      }
      case 'PLACE_TEST_ORDER': {
        if (product.status !== 'PUBLISHED') fail('NOT_PUBLISHED', 'لا يمكن شراء منتج غير منشور/معتمد.', 422);
        const qty = Number(payload.qty || 1);
        if (!Number.isInteger(qty) || qty < 1 || qty > product.quote.capacityQty) fail('INVALID_QUANTITY', 'الكمية خارج حدود طاقة العرض التجريبي.', 422);
        const variant = latestVersion()?.spec.variants.find(item => item.id === payload.variant);
        if (!variant) fail('INVALID_VARIANT', 'الخيار غير معتمد في نسخة المنتج.', 422);
        const key = String(payload.idempotencyKey || '');
        if (!key || key.length > 120) fail('IDEMPOTENCY_REQUIRED', 'يلزم مفتاح تكرار صالح.', 422);
        const idem = `order:${actor.id}:${key}`;
        if (idempotency.has(idem)) return { message: 'الطلب التجريبي موجود مسبقًا؛ لم يتكرر.', idempotent: true, order: clone(orders.find(item => item.id === idempotency.get(idem))) };
        const orderId = `ORD-DEMO-${String(++sequence.order).padStart(4, '0')}`;
        const quote = clone(product.quote);
        const snapshot = freezeDeep({
          productId: product.id,
          productName: product.name,
          category: product.category,
          specVersion: latestVersion().version,
          spec: clone(latestVersion().spec),
          variant: clone(variant),
          quoteId: quote.id,
          quoteUnitCostCents: quote.unitCostCents,
          quotedLeadDays: quote.leadDays,
          retailPriceCents: product.demoRetailPriceCents,
          demoOnly: true
        });
        const order = {
          id: orderId, reference: orderId, customerId: actor.customerId,
          status: 'ORDER_CONFIRMED_DEMO', qty, variant: clone(variant),
          itemSubtotalCents: product.demoRetailPriceCents * qty,
          payment: { mode: 'SIMULATED_ONLY', status: 'NOT_CHARGED', provider: 'MOCK', note: 'لا توجد عملية دفع أو حجز أموال.' },
          snapshot, createdAt: nowISO, productionOrderId: null, shipmentId: null, claimId: null
        };
        orders.push(order);
        idempotency.set(idem, order.id);
        event('TEST_ORDER_CREATED', actor, { orderId, specVersion: snapshot.specVersion, qty });
        return { message: 'أُنشئ طلب تجريبي ببيانات صناعية؛ لم يحدث دفع.', order: normalizedCustomerOrder(order, 'customer'), state: view(actor) };
      }
      case 'CREATE_PRODUCTION_ORDER': {
        const order = requireOrder(String(payload.orderId || ''), actor);
        if (actor.role !== 'operations') fail('FORBIDDEN', 'إنشاء أمر التصنيع من اختصاص العمليات.', 403);
        const existing = productionOrders.find(work => work.orderId === order.id);
        if (existing) return { message: 'يوجد أمر تصنيع واحد لهذا الطلب؛ لم يتكرر.', idempotent: true, productionOrder: clone(existing) };
        const idemKey = String(payload.idempotencyKey || '');
        if (!idemKey || idemKey.length > 120) fail('IDEMPOTENCY_REQUIRED', 'يلزم مفتاح تكرار صالح.', 422);
        const idem = `production:${order.id}:${idemKey}`;
        if (idempotency.has(idem)) return { message: 'أمر التصنيع السابق موجود.', idempotent: true, productionOrder: clone(productionOrders.find(work => work.id === idempotency.get(idem))) };
        if (order.payment.status !== 'NOT_CHARGED') fail('PAYMENT_STATE', 'حالة الدفع التجريبية غير متوقعة.');
        if (!product.quote || order.snapshot.quoteId !== product.quote.id) fail('QUOTE_CHANGED', 'العرض لم يعد مطابقًا لنسخة الطلب؛ يلزم تدخل بشري.');
        const workId = `MO-DEMO-${String(++sequence.production).padStart(4, '0')}`;
        const work = {
          id: workId,
          reference: workId,
          orderId: order.id,
          orderReference: order.reference,
          factoryId: product.factoryId,
          qty: order.qty,
          status: 'PENDING_FACTORY_ACCEPTANCE',
          dueDate: new Date(now().getTime() + product.quote.leadDays * 86400000).toISOString(),
          specSnapshot: clone(order.snapshot),
          quote: clone(product.quote),
          factoryNotes: 'يرى المصنع المواصفة وخيارات الإنتاج فقط؛ لا بيانات عميل.',
          qc: null,
          shipmentId: null,
          events: [{ at: nowISO, type: 'CREATED', actor: actor.id }]
        };
        productionOrders.push(work);
        order.productionOrderId = workId;
        idempotency.set(idem, workId);
        event('PRODUCTION_ORDER_CREATED', actor, { orderId: order.id, productionOrderId: workId, factoryId: work.factoryId });
        return { message: 'أُنشئ أمر تصنيع واحد بنسخة المواصفة المثبتة. لم يُرسل للمصنع.', productionOrder: clone(work), state: view(actor) };
      }
      case 'ACCEPT_WORK_ORDER': {
        const work = requireProduction(String(payload.productionOrderId || ''), actor);
        if (work.status !== 'PENDING_FACTORY_ACCEPTANCE') fail('INVALID_TRANSITION', 'أمر التصنيع ليس بانتظار القبول.');
        work.status = 'ACCEPTED';
        work.events.push({ at: nowISO, type: 'FACTORY_ACCEPTED', actor: actor.id });
        event('FACTORY_ACCEPTED_WORK', actor, { productionOrderId: work.id, factoryId: work.factoryId });
        return { message: 'قُبل أمر التصنيع داخل المحاكاة فقط.', state: view(actor) };
      }
      case 'START_PRODUCTION': {
        const work = requireProduction(String(payload.productionOrderId || ''), actor);
        if (work.status !== 'ACCEPTED') fail('INVALID_TRANSITION', 'يجب قبول الأمر قبل بدء الإنتاج.');
        work.status = 'IN_PRODUCTION';
        work.events.push({ at: nowISO, type: 'PRODUCTION_STARTED', actor: actor.id });
        event('PRODUCTION_STARTED', actor, { productionOrderId: work.id, factoryId: work.factoryId });
        return { message: 'سُجل بدء الإنتاج في سجل العرض التجريبي.', state: view(actor) };
      }
      case 'READY_FOR_QC': {
        const work = requireProduction(String(payload.productionOrderId || ''), actor);
        if (work.status !== 'IN_PRODUCTION') fail('INVALID_TRANSITION', 'لا يمكن إرسال الجودة قبل بدء الإنتاج.');
        work.status = 'QC_PENDING';
        work.events.push({ at: nowISO, type: 'READY_FOR_QC', actor: actor.id });
        event('READY_FOR_QC', actor, { productionOrderId: work.id, factoryId: work.factoryId });
        return { message: 'سُجل جاهزية للفحص داخل المحاكاة؛ لم يرفع المصنع أدلة حقيقية.', state: view(actor) };
      }
      case 'RECORD_QC': {
        const work = requireProduction(String(payload.productionOrderId || ''), actor);
        if (!['QC_PENDING', 'REWORK_REQUIRED'].includes(work.status)) fail('INVALID_TRANSITION', 'الفحص غير متاح في هذه المرحلة.');
        const checks = Array.isArray(payload.checks) ? payload.checks : [];
        const requiredChecks = latestVersion()?.spec.qualityChecks || [];
        const results = requiredChecks.map(check => {
          const result = checks.find(item => item.id === check.id);
          return { id: check.id, target: check.target, result: result?.result === 'PASS' ? 'PASS' : 'FAIL', evidence: 'SYNTHETIC_DEMO' };
        });
        const passed = results.length === requiredChecks.length && results.length > 0 && results.every(item => item.result === 'PASS');
        work.qc = { passed, inspectedAt: nowISO, inspector: actor.id, results, evidenceMode: 'SYNTHETIC_DEMO' };
        work.status = passed ? 'QC_PASSED' : 'REWORK_REQUIRED';
        work.events.push({ at: nowISO, type: passed ? 'QC_PASSED' : 'QC_FAILED', actor: actor.id });
        event(passed ? 'QC_PASSED' : 'QC_FAILED', actor, { productionOrderId: work.id, resultCount: results.length });
        return { message: passed ? 'اجتاز الفحص التجريبي؛ الأدلة صناعية ولا تثبت جودة منتج حقيقي.' : 'فشل الفحص؛ الشحن محظور حتى إعادة العمل وإعادة الفحص.', state: view(actor) };
      }
      case 'COMPLETE_REWORK': {
        const work = requireProduction(String(payload.productionOrderId || ''), actor);
        if (work.status !== 'REWORK_REQUIRED') fail('INVALID_TRANSITION', 'لا توجد إعادة عمل معلقة.');
        work.status = 'QC_PENDING';
        work.events.push({ at: nowISO, type: 'REWORK_COMPLETED', actor: actor.id });
        event('REWORK_COMPLETED', actor, { productionOrderId: work.id, factoryId: work.factoryId });
        return { message: 'سُجلت إعادة عمل تجريبية؛ الفحص ما زال مطلوبًا.', state: view(actor) };
      }
      case 'CREATE_MANUAL_SHIPMENT': {
        const work = requireProduction(String(payload.productionOrderId || ''), actor);
        if (work.status !== 'QC_PASSED') fail('QC_REQUIRED', 'يُحظر إنشاء الشحنة قبل نجاح فحص الجودة.');
        if (work.shipmentId) fail('SHIPMENT_EXISTS', 'توجد شحنة مسجلة لهذا الأمر.');
        const order = orders.find(item => item.id === work.orderId);
        const shipment = {
          id: `SHIP-DEMO-${String(++sequence.shipment).padStart(4, '0')}`,
          orderId: order.id,
          orderReference: order.reference,
          productionOrderId: work.id,
          carrierLabel: 'ناقل يدوي (محاكاة)',
          trackingReference: `DEMO-TRACK-${String(sequence.shipment).padStart(4, '0')}`,
          state: 'LABEL_CREATED',
          mode: 'MANUAL_DEMO_NOT_SENT',
          events: [{ at: nowISO, type: 'LABEL_CREATED_DEMO', actor: actor.id }]
        };
        shipments.push(shipment);
        work.shipmentId = shipment.id;
        order.shipmentId = shipment.id;
        work.status = 'SHIPMENT_RECORDED_DEMO';
        work.events.push({ at: nowISO, type: 'SHIPMENT_RECORDED_DEMO', actor: actor.id });
        event('SHIPMENT_CREATED_DEMO', actor, { shipmentId: shipment.id, productionOrderId: work.id });
        return { message: 'سُجلت شحنة محاكاة يدويًا؛ لم يُنشأ ملصق حقيقي ولم تُرسل بيانات لناقل.', state: view(actor) };
      }
      case 'HANDOFF_TO_CARRIER': {
        const shipment = shipments.find(item => item.id === payload.shipmentId);
        if (!shipment) fail('NOT_FOUND', 'الشحنة غير موجودة.', 404);
        const work = productionOrders.find(item => item.id === shipment.productionOrderId);
        if (actor.role !== 'operations') fail('FORBIDDEN', 'التسليم للناقل يسجله فريق العمليات.');
        if (shipment.state !== 'LABEL_CREATED') fail('INVALID_TRANSITION', 'الشحنة ليست بانتظار التسليم.');
        shipment.state = 'HANDED_TO_CARRIER';
        shipment.mode = 'MANUAL_OPERATOR_ATTESTATION_DEMO';
        shipment.events.push({ at: nowISO, type: 'HANDED_TO_CARRIER_DEMO', actor: actor.id });
        work.status = 'HANDED_TO_CARRIER_DEMO';
        work.events.push({ at: nowISO, type: 'HANDED_TO_CARRIER_DEMO', actor: actor.id });
        event('SHIPMENT_HANDED_TO_CARRIER_DEMO', actor, { shipmentId: shipment.id });
        return { message: 'سُجل إقرار يدوي داخل العرض؛ لا يثبت تسليمًا فعليًا للناقل.', state: view(actor) };
      }
      case 'UPDATE_TRACKING': {
        const shipment = shipments.find(item => item.id === payload.shipmentId);
        if (!shipment) fail('NOT_FOUND', 'الشحنة غير موجودة.', 404);
        const allowed = ['IN_TRANSIT', 'DELIVERED', 'EXCEPTION'];
        if (!allowed.includes(payload.state)) fail('INVALID_SHIPMENT_STATE', 'حالة التتبع غير مسموحة.', 422);
        const order = orders.find(item => item.id === shipment.orderId);
        const work = productionOrders.find(item => item.id === shipment.productionOrderId);
        const expected = { HANDED_TO_CARRIER: ['IN_TRANSIT', 'EXCEPTION'], IN_TRANSIT: ['DELIVERED', 'EXCEPTION'], EXCEPTION: ['IN_TRANSIT', 'DELIVERED'] };
        if (!expected[shipment.state]?.includes(payload.state)) fail('INVALID_TRANSITION', 'تسلسل التتبع غير صالح.');
        shipment.state = payload.state;
        shipment.events.push({ at: nowISO, type: `${payload.state}_DEMO`, actor: actor.id });
        order.status = payload.state === 'DELIVERED' ? 'DELIVERED_DEMO' : order.status;
        work.status = payload.state === 'DELIVERED' ? 'DELIVERED_DEMO' : work.status;
        event('TRACKING_UPDATED_DEMO', actor, { shipmentId: shipment.id, state: payload.state });
        return { message: 'حُدث التتبع التجريبي يدويًا؛ لا توجد API ناقل موصولة.', state: view(actor) };
      }
      case 'OPEN_CLAIM': {
        const order = requireOrder(String(payload.orderId || ''), actor);
        const key = String(payload.idempotencyKey || '');
        if (!key || key.length > 120) fail('IDEMPOTENCY_REQUIRED', 'يلزم مفتاح تكرار صالح.', 422);
        const idem = `claim:${order.id}:${key}`;
        if (idempotency.has(idem)) return { message: 'المطالبة التجريبية موجودة مسبقًا.', idempotent: true, claim: clone(claims.find(item => item.id === idempotency.get(idem))) };
        const allowedReasons = ['DELAY', 'DAMAGE', 'SPEC_MISMATCH', 'OTHER'];
        if (!allowedReasons.includes(payload.reason)) fail('INVALID_CLAIM_REASON', 'سبب المطالبة غير معروف.', 422);
        const claim = { id: `CLM-DEMO-${String(++sequence.claim).padStart(4, '0')}`, orderId: order.id, orderReference: order.reference, customerId: actor.customerId, reason: payload.reason, status: 'OPEN', openedAt: nowISO, resolution: null };
        claims.push(claim);
        order.claimId = claim.id;
        idempotency.set(idem, claim.id);
        event('CLAIM_OPENED_DEMO', actor, { claimId: claim.id, orderId: order.id, reason: claim.reason });
        return { message: 'سُجلت مطالبة تجريبية بلا بيانات عميل حقيقية.', claim: clone(claim), state: view(actor) };
      }
      case 'RESOLVE_CLAIM': {
        const claim = claims.find(item => item.id === payload.claimId);
        if (!claim) fail('NOT_FOUND', 'المطالبة غير موجودة.', 404);
        if (claim.status !== 'OPEN') fail('INVALID_TRANSITION', 'المطالبة ليست مفتوحة.');
        const resolution = String(payload.resolution || '').trim();
        if (resolution.length < 4 || resolution.length > 240) fail('INVALID_RESOLUTION', 'أدخل قرارًا موجزًا من 4 إلى 240 حرفًا.', 422);
        claim.status = 'RESOLVED';
        claim.resolution = resolution;
        claim.resolvedAt = nowISO;
        claim.resolvedBy = actor.id;
        event('CLAIM_RESOLVED_DEMO', actor, { claimId: claim.id, resolutionLength: resolution.length });
        return { message: 'أُغلقت المطالبة داخل المحاكاة.', state: view(actor) };
      }
      default: fail('UNKNOWN_ACTION', 'الإجراء غير معروف.', 404);
    }
  }

  function reviseActiveSpec(actor, patch = {}) {
    requireRole(actor, 'CREATE_SPEC');
    if (!['SPEC_REVIEW', 'FACTORY_REVIEW', 'APPROVED', 'PUBLISHED'].includes(product.status)) fail('INVALID_TRANSITION', 'لا يمكن إنشاء نسخة جديدة في هذه المرحلة.');
    const oldVersion = latestVersion();
    if (!oldVersion) fail('SPEC_REQUIRED', 'لا توجد مواصفة سابقة.');
    const next = clone(oldVersion);
    next.version += 1;
    next.createdAt = stamp();
    next.createdBy = actor.id;
    next.status = 'SPEC_REVIEW';
    if (patch.packaging) next.spec.packaging = { value: String(patch.packaging).slice(0, 120), provenance: 'HUMAN_REVIEWED_DEMO' };
    product.versions.push(next);
    product.activeVersion = next.version;
    product.quote = null;
    product.approval = null;
    product.publishedAt = null;
    product.status = 'SPEC_REVIEW';
    event('SPEC_VERSION_REVISED', actor, { productId: product.id, priorVersion: oldVersion.version, version: next.version });
    return { version: next.version, previousVersion: oldVersion.version };
  }

  function actionLabel(action) { return ACTION_LABELS[action] || action; }

  return Object.freeze({
    view,
    perform,
    reviseActiveSpec,
    actionLabel,
    getSnapshot() {
      return clone({ product, orders, productionOrders, shipments, claims, events });
    }
  });
}
