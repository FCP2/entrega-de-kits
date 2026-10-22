const path = require('node:path');
const express = require('express');
const auth = require('./auth');
const repository = require('./repository');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "connect-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"
  ].join('; '));
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/session', (req, res) => {
  const session = auth.readSession(req);
  res.json(session
    ? { authenticated: true, operator: session.operator, csrf: auth.csrfFor(session) }
    : { authenticated: false });
});

app.post('/api/login', (req, res) => {
  if (!auth.configured()) {
    return res.status(503).json({ code: 'NOT_CONFIGURED', message: 'Falta configurar el acceso del sistema.' });
  }
  const { username, password } = req.body || {};
  const operator = String(req.body?.operator || '').trim().replace(/\s+/g, ' ');
  if (operator.length < 2 || operator.length > 80) {
    return res.status(400).json({ code: 'INVALID_OPERATOR', message: 'Escribe el nombre de quien entregará los kits (2 a 80 caracteres).' });
  }
  if (!auth.safeEqual(username, process.env.KIT_ADMIN_USER) ||
      !auth.safeEqual(password, process.env.KIT_ADMIN_PASSWORD)) {
    return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Usuario o contraseña incorrectos.' });
  }
  auth.setSessionCookie(req, res, operator);
  res.json({ ok: true });
});

app.use('/api', auth.requireSession);

app.post('/api/logout', auth.requireCsrf, (req, res) => {
  auth.clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/resumen', async (req, res, next) => {
  try { res.json(await repository.summary()); } catch (error) { next(error); }
});

app.get('/api/buscar', async (req, res, next) => {
  const query = repository.normalizeSearch(req.query.q);
  if (query.length < 2 || query.length > 120) {
    return res.status(400).json({ code: 'INVALID_SEARCH', message: 'Escribe al menos 2 caracteres del nombre o un folio válido.' });
  }
  try { res.json({ results: await repository.search(query) }); }
  catch (error) { next(error); }
});

app.post('/api/entregas', auth.requireCsrf, async (req, res, next) => {
  const registroId = Number(req.body?.registroId);
  if (!Number.isSafeInteger(registroId) || registroId <= 0) {
    return res.status(400).json({ code: 'INVALID_RECORD', message: 'Selecciona un registro válido.' });
  }
  try {
    const result = await repository.deliver(registroId, req.session.operator);
    if (result.status === 'already_delivered') {
      return res.status(409).json({ code: 'ALREADY_DELIVERED', message: 'Este kit ya fue entregado.', delivery: result });
    }
    if (result.status === 'not_confirmed') {
      return res.status(409).json({ code: 'NOT_CONFIRMED', message: 'Este registro ya no está confirmado o no tiene folio.' });
    }
    res.status(201).json(result);
  } catch (error) { next(error); }
});

app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Ruta no encontrada.' }));
app.use((error, req, res, next) => {
  console.error('Control de kits:', error.code || error.message);
  if (error.code === '42P01') {
    return res.status(503).json({ code: 'MISSING_TABLE', message: 'Falta instalar la tabla de entregas de kits.' });
  }
  res.status(500).json({ code: 'SERVER_ERROR', message: 'No fue posible completar la operación. Intenta de nuevo.' });
});

module.exports = app;
