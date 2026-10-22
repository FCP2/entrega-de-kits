const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/kit_test';
process.env.KIT_ADMIN_USER = `test_${crypto.randomBytes(8).toString('hex')}`;
process.env.KIT_ADMIN_PASSWORD = crypto.randomBytes(24).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');

const repository = require('../repository');
const pool = require('../db');
const app = require('../app');
const { handler } = require('../netlify/functions/app');

test('la función de Netlify recibe el nombre de quien entrega', async () => {
  const body = JSON.stringify({
    operator: 'Ana Pérez',
    username: process.env.KIT_ADMIN_USER,
    password: process.env.KIT_ADMIN_PASSWORD
  });
  const response = await handler({
    httpMethod: 'POST', path: '/api/login',
    headers: { 'content-type': 'application/json' },
    body, isBase64Encoded: false
  }, {});
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  const cookie = response.headers['set-cookie'].split(';')[0];
  const sessionResponse = await handler({
    httpMethod: 'GET', path: '/api/session', headers: { cookie }, body: ''
  }, {});
  const session = JSON.parse(sessionResponse.body);
  assert.equal(session.authenticated, true);
  assert.equal(session.operator, 'Ana Pérez');

  const originalDeliver = repository.deliver;
  repository.deliver = async (registroId, operator) => ({
    status: 'delivered', registro_id: registroId, entregado_por: operator
  });
  try {
    const deliveryResponse = await handler({
      httpMethod: 'POST', path: '/api/entregas',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrf },
      body: JSON.stringify({ registroId: 55 }), isBase64Encoded: false
    }, {});
    assert.equal(deliveryResponse.statusCode, 201);
    assert.equal(JSON.parse(deliveryResponse.body).entregado_por, 'Ana Pérez');
  } finally {
    repository.deliver = originalDeliver;
  }
});

test('la búsqueda acepta nombres con o sin acento y el folio del QR', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  };
  try {
    await repository.search('Francisco Vicencio Gutiérrez');
    await repository.search('francisco vicencio gutierrez');
    assert.equal(calls[0].params[2], '%francisco vicencio gutierrez%');
    assert.equal(calls[1].params[2], calls[0].params[2]);
    assert.match(calls[0].sql, /TRANSLATE\(LOWER\(CONCAT_WS/);

    await repository.search('Voces que Corren\nFolio: VC-2026-0042\nNombre: Ana Pérez');
    assert.equal(calls[2].params[1], 'VC-2026-0042');
  } finally {
    pool.query = originalQuery;
  }
});

test('autenticación, consulta y entrega única desde dos solicitudes', async () => {
  const originals = {
    summary: repository.summary, search: repository.search, deliver: repository.deliver
  };
  const delivered = new Set();
  repository.summary = async () => ({ confirmados: 2, entregados: delivered.size, capacidad: 4 });
  repository.search = async () => [{ registro_id: 55, folio: 'VC-2026-0055', nombre: 'Ana Pérez', talla: 'M' }];
  repository.deliver = async (id, operator) => {
    if (delivered.has(id)) return { status: 'already_delivered' };
    delivered.add(id);
    return { status: 'delivered', registro_id: id, entregado_por: operator };
  };
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const unauthorized = await fetch(`${url}/api/resumen`);
    assert.equal(unauthorized.status, 401);

    const wrong = await fetch(`${url}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: 'Ana Pérez', username: process.env.KIT_ADMIN_USER, password: 'incorrecta' })
    });
    assert.equal(wrong.status, 401);

    const login = await fetch(`${url}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: 'Ana Pérez', username: process.env.KIT_ADMIN_USER, password: process.env.KIT_ADMIN_PASSWORD })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^kit_session=/);
    const page = await fetch(url, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /bootstrap\.min\.css/);
    assert.match(html, /<span id="operatorName"><\/span>/);
    const bootstrap = await fetch(`${url}/vendor/bootstrap.min.css`);
    assert.equal(bootstrap.status, 200);
    const qrReader = await fetch(`${url}/vendor/html5-qrcode.min.js`);
    assert.equal(qrReader.status, 200);
    const sessionResponse = await fetch(`${url}/api/session`, { headers: { Cookie: cookie } });
    const session = await sessionResponse.json();
    assert.equal(session.authenticated, true);
    assert.equal(session.operator, 'Ana Pérez');
    const csrf = session.csrf;

    const summary = await fetch(`${url}/api/resumen`, { headers: { Cookie: cookie } });
    assert.deepEqual(await summary.json(), { confirmados: 2, entregados: 0, capacidad: 4 });
    const lookup = await fetch(`${url}/api/buscar?q=VC-2026-0055`, { headers: { Cookie: cookie } });
    assert.equal((await lookup.json()).results[0].registro_id, 55);

    const payload = { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ registroId: 55 }) };
    assert.equal((await fetch(`${url}/api/entregas`, payload)).status, 403);
    const validPayload = { ...payload, headers: { ...payload.headers, 'X-CSRF-Token': csrf } };
    const [first, second] = await Promise.all([
      fetch(`${url}/api/entregas`, validPayload), fetch(`${url}/api/entregas`, validPayload)
    ]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    assert.equal(delivered.size, 1);
  } finally {
    repository.summary = originals.summary;
    repository.search = originals.search;
    repository.deliver = originals.deliver;
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
