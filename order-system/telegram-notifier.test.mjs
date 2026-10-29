import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendOrderAlert } from './telegram-notifier.mjs';

// Fake credentials used only by injected local mocks; no network requests.
const token = '123456:' + 'x'.repeat(25);
const request = { token, chatId: '123456789', reference: 'RAWAA-TEST123' };

test('sends only the reference and explicit human review status', async () => {
  let body;
  const result = await sendOrderAlert({ ...request, fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true, result: { message_id: 1, chat: { id: 123456789 } } }) };
  } });
  assert.deepEqual(result, { ok: true });
  assert.equal(body.chat_id, request.chatId);
  assert.match(body.text, /RAWAA-TEST123/);
  assert.match(body.text, /بانتظار المراجعة/);
  assert.ok(!body.text.includes('0991234567'));
});

test('rejects incomplete configuration without making a request', async () => {
  const result = await sendOrderAlert({ ...request, token: '', fetchImpl: () => { throw new Error('unexpected'); } });
  assert.deepEqual(result, { ok: false, reason: 'not_configured' });
});

test('returns safe failures and never leaks provider error or secret', async () => {
  const invalid = await sendOrderAlert({ ...request, reference: 'bad' });
  assert.deepEqual(invalid, { ok: false, reason: 'invalid_reference' });
  const rejected = await sendOrderAlert({ ...request, fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(rejected, { ok: false, reason: 'delivery_unknown' });
  const unknown = await sendOrderAlert({ ...request, fetchImpl: async () => { throw new Error(token); } });
  assert.deepEqual(unknown, { ok: false, reason: 'delivery_unknown' });
  assert.ok(!JSON.stringify(unknown).includes(token));
  const apiReject = await sendOrderAlert({ ...request, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }) });
  assert.deepEqual(apiReject, { ok: false, reason: 'delivery_failed' });
});

test('does not treat malformed success or wrong destination as delivered', async () => {
  for (const result of [undefined, { message_id: 1, chat: { id: 42 } }]) {
    const response = await sendOrderAlert({ ...request, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result }) }) });
    assert.deepEqual(response, { ok: false, reason: 'delivery_unknown' });
  }
});
