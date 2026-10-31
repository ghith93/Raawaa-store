import test from 'node:test';
import assert from 'node:assert/strict';
import { createManufacturingDomain, PERSONAS } from './domain.mjs';

const persona = id => PERSONAS.find(item => item.id === id);
const byRole = role => PERSONAS.find(item => item.role === role);
const makeDomain = () => {
  let ids = 0;
  const fixed = new Date('2026-10-31T12:00:00.000Z');
  return createManufacturingDomain({ idFactory: () => `demo-id-${++ids}-abcdefgh`, now: () => new Date(fixed) });
};
const run = (domain, id, action, payload = {}) => domain.perform(persona(id), action, payload);

test('end-to-end synthetic manufacturing flow gates shipping on QC and supports a claim', () => {
  const domain = makeDomain();
  const designer = persona('designer');
  const ops = persona('operations');
  const factory = persona('factory-north');
  const quality = persona('quality');
  const owner = persona('owner');
  const customer = persona('customer-demo');
  const support = persona('support');

  assert.equal(domain.view(designer).prototype.aiProvider, 'mock');
  assert.equal(domain.view(designer).product.status, 'DRAFT');
  assert.equal('quote' in domain.view(designer).product, false);
  run(domain, designer.id, 'GENERATE_CONCEPT');
  run(domain, designer.id, 'CREATE_SPEC');
  const spec = domain.view(designer).product.versions[0].spec;
  assert.equal(spec.technicalFiles.status, 'NOT_PROVIDED');
  assert.ok(spec.qualityChecks.length >= 3);

  run(domain, ops.id, 'REQUEST_FACTORY_REVIEW');
  assert.throws(() => run(domain, 'factory-east', 'SUBMIT_FACTORY_QUOTE'), error => error.code === 'FORBIDDEN');
  assert.equal(domain.view(persona('factory-east')).product, null);
  run(domain, factory.id, 'SUBMIT_FACTORY_QUOTE');
  assert.equal(domain.view(designer).product.quote, undefined);
  assert.equal(domain.view(persona('finance')).quote.synthetic, true);
  run(domain, owner.id, 'APPROVE_PRODUCT');
  run(domain, owner.id, 'PUBLISH_PRODUCT');

  const customerView = domain.view(customer);
  assert.equal(customerView.product.demoOnly, true);
  assert.equal(customerView.product.priceCents, 2400);
  run(domain, customer.id, 'PLACE_TEST_ORDER', { qty: 1, variant: 'sage', idempotencyKey: 'order-demo-1' });
  const order = domain.view(customer).orders[0];
  assert.equal(order.payment.status, 'NOT_CHARGED');
  assert.equal(order.specVersion, 1);
  const duplicate = run(domain, customer.id, 'PLACE_TEST_ORDER', { qty: 1, variant: 'sage', idempotencyKey: 'order-demo-1' });
  assert.equal(duplicate.idempotent, true);
  assert.equal(domain.view(customer).orders.length, 1);

  run(domain, ops.id, 'CREATE_PRODUCTION_ORDER', { orderId: order.id, idempotencyKey: `production-${order.id}` });
  const workId = domain.view(ops).productionOrders[0].id;
  assert.equal(domain.view(persona('factory-east')).productionOrders.length, 0);
  const factoryWork = domain.view(factory).productionOrders[0];
  assert.equal(factoryWork.specSnapshot.specVersion, 1);
  assert.equal('retailPriceCents' in factoryWork.specSnapshot, false);
  assert.equal('customerId' in factoryWork.specSnapshot, false);
  const qualityWork = domain.view(quality).productionOrders[0];
  assert.equal('quoteUnitCostCents' in qualityWork.specSnapshot, false);
  assert.equal('retailPriceCents' in qualityWork.specSnapshot, false);

  run(domain, factory.id, 'ACCEPT_WORK_ORDER', { productionOrderId: workId });
  run(domain, factory.id, 'START_PRODUCTION', { productionOrderId: workId });
  run(domain, factory.id, 'READY_FOR_QC', { productionOrderId: workId });
  const checks = spec.qualityChecks.map(item => ({ id: item.id, result: 'PASS' }));
  run(domain, quality.id, 'RECORD_QC', { productionOrderId: workId, checks: checks.map((item, index) => index === 0 ? { ...item, result: 'FAIL' } : item) });
  assert.equal(domain.view(ops).productionOrders[0].status, 'REWORK_REQUIRED');
  assert.throws(() => run(domain, ops.id, 'CREATE_MANUAL_SHIPMENT', { productionOrderId: workId }), error => error.code === 'QC_REQUIRED');
  run(domain, factory.id, 'COMPLETE_REWORK', { productionOrderId: workId });
  run(domain, quality.id, 'RECORD_QC', { productionOrderId: workId, checks });
  assert.equal(domain.view(ops).productionOrders[0].status, 'QC_PASSED');

  run(domain, ops.id, 'CREATE_MANUAL_SHIPMENT', { productionOrderId: workId });
  const shipment = domain.view(ops).shipments[0];
  run(domain, ops.id, 'HANDOFF_TO_CARRIER', { shipmentId: shipment.id });
  run(domain, ops.id, 'UPDATE_TRACKING', { shipmentId: shipment.id, state: 'IN_TRANSIT' });
  run(domain, ops.id, 'UPDATE_TRACKING', { shipmentId: shipment.id, state: 'EXCEPTION' });
  assert.equal(domain.view(ops).shipments[0].state, 'EXCEPTION');
  run(domain, ops.id, 'UPDATE_TRACKING', { shipmentId: shipment.id, state: 'IN_TRANSIT' });
  run(domain, ops.id, 'UPDATE_TRACKING', { shipmentId: shipment.id, state: 'DELIVERED' });
  assert.equal(domain.view(customer).shipments[0].state, 'DELIVERED');
  run(domain, customer.id, 'OPEN_CLAIM', { orderId: order.id, reason: 'DELAY', idempotencyKey: 'claim-demo-1' });
  const claim = domain.view(support).claims[0];
  assert.equal(claim.status, 'OPEN');
  run(domain, support.id, 'RESOLVE_CLAIM', { claimId: claim.id, resolution: 'تمت مراجعة الحالة التجريبية.' });
  assert.equal(domain.view(support).claims[0].status, 'RESOLVED');
});

test('server-side persona validation binds factories and customers to their exact demo identity', () => {
  const domain = makeDomain();
  assert.throws(() => domain.view({ id: 'factory-east', role: 'factory', factoryId: 'factory-north' }), error => error.code === 'INVALID_DEMO_ACTOR');
  assert.throws(() => domain.view({ id: 'customer-demo', role: 'customer', customerId: 'someone-else' }), error => error.code === 'INVALID_DEMO_ACTOR');
  assert.throws(() => domain.perform(persona('support'), 'PUBLISH_PRODUCT'), error => error.code === 'FORBIDDEN');
  assert.throws(() => domain.perform(persona('owner'), 'ACCEPT_WORK_ORDER'), error => error.code === 'FORBIDDEN');
  assert.throws(() => domain.perform(persona('operations'), 'APPROVE_PRODUCT'), error => error.code === 'FORBIDDEN');
});
