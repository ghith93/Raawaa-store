import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createManufacturingDomain, PERSONAS } from './domain.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 16 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function cookieValue(header, name) {
  const entry = String(header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY) {
      const error = new Error('حجم الطلب أكبر من الحد التجريبي.');
      error.status = 413;
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch {
    const error = new Error('JSON غير صالح.');
    error.status = 400;
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'x-prototype-only': 'true',
    ...headers
  });
  res.end(body);
}

export function createManufacturingPrototypeServer({ domain = createManufacturingDomain() } = {}) {
  const sessions = new Map();

  function personaFor(req, res) {
    const sid = cookieValue(req.headers.cookie, 'rawaa_mfg_demo');
    let session = sessions.get(sid);
    if (!session) {
      const nextSid = randomUUID();
      session = { sid: nextSid, personaId: 'designer' };
      sessions.set(nextSid, session);
      res.setHeader('set-cookie', `rawaa_mfg_demo=${encodeURIComponent(nextSid)}; Path=/; HttpOnly; SameSite=Lax`);
    }
    return PERSONAS.find(item => item.id === session.personaId) || PERSONAS[1];
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; }
    catch { return false; }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true, mode: 'local-synthetic-demo', persistence: 'memory-only', integrations: { ai: 'mock', payment: 'mock', shipping: 'manual-demo' } });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const actor = personaFor(req, res);
        return send(res, 200, domain.view(actor));
      }
      if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'forbidden', message: 'طلبات العرض يجب أن تكون من نفس الأصل.' });
      if (req.method === 'POST' && url.pathname === '/api/demo/persona') {
        const body = await readJson(req);
        const persona = PERSONAS.find(item => item.id === body.personaId);
        if (!persona) return send(res, 422, { error: 'invalid_persona', message: 'Persona غير معروفة.' });
        const sid = cookieValue(req.headers.cookie, 'rawaa_mfg_demo') || randomUUID();
        sessions.set(sid, { sid, personaId: persona.id });
        return send(res, 200, { ok: true, actor: { id: persona.id, role: persona.role, label: persona.label } }, {
          'set-cookie': `rawaa_mfg_demo=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const actor = personaFor(req, res);
        const body = await readJson(req);
        if (typeof body.action !== 'string' || body.action.length > 80) return send(res, 422, { error: 'invalid_action', message: 'الإجراء غير صالح.' });
        const result = domain.perform(actor, body.action, body.payload || {});
        return send(res, 200, { ok: true, ...result });
      }
      if (req.method === 'GET' && ['/', '/index.html', '/app.js', '/styles.css'].includes(url.pathname)) {
        const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const content = await readFile(path.join(ROOT, filename));
        res.writeHead(200, {
          'content-type': MIME[path.extname(filename)],
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          'x-prototype-only': 'true'
        });
        return res.end(content);
      }
      if (req.method === 'OPTIONS') return send(res, 405, { error: 'method_not_allowed' });
      return send(res, 404, { error: 'not_found' });
    } catch (error) {
      return send(res, Number(error.status) || 400, {
        error: String(error.code || 'request_failed').slice(0, 80),
        message: String(error.message || 'تعذر إكمال الإجراء.').slice(0, 240)
      });
    }
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4174);
  const host = process.env.HOST || '0.0.0.0';
  const server = createManufacturingPrototypeServer();
  server.listen(port, host, () => {
    console.log(`Local synthetic manufacturing prototype: http://${host}:${port}`);
    console.log('Memory-only data; demo personas are not authentication; no real AI, payment, factory, or shipping integration.');
  });
}
