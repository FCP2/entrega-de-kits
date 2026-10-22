const crypto = require('node:crypto');

const COOKIE_NAME = 'kit_session';
const SESSION_SECONDS = 10 * 60 * 60;

function configured() {
  return Boolean(
    process.env.KIT_ADMIN_USER &&
    process.env.KIT_ADMIN_PASSWORD?.length >= 16 &&
    process.env.SESSION_SECRET?.length >= 32
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signature(payload) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload).digest('base64url');
}

function createSession(operator) {
  const payload = Buffer.from(JSON.stringify({
    operator,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: crypto.randomBytes(12).toString('hex')
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function readSession(req) {
  if (!configured()) return null;
  const cookie = String(req.headers.cookie || '').split(';')
    .map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  const token = cookie.slice(COOKIE_NAME.length + 1);
  const parts = token.split('.');
  if (parts.length !== 2 || !safeEqual(parts[1], signature(parts[0]))) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return Number.isInteger(data.exp) && data.exp > Date.now() / 1000 &&
      typeof data.operator === 'string' && data.operator.length >= 2
      ? { operator: data.operator, token } : null;
  } catch { return null; }
}

function csrfFor(session) {
  return signature(`csrf:${session.token}`);
}

function requireSession(req, res, next) {
  req.session = readSession(req);
  if (!req.session) return res.status(401).json({ code: 'SESSION_EXPIRED', message: 'La sesión terminó. Inicia sesión de nuevo.' });
  next();
}

function requireCsrf(req, res, next) {
  if (!safeEqual(req.get('X-CSRF-Token'), csrfFor(req.session))) {
    return res.status(403).json({ code: 'INVALID_CSRF', message: 'La solicitud ya no es válida. Actualiza la página.' });
  }
  next();
}

function setSessionCookie(req, res, operator) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.cookie(COOKIE_NAME, createSession(operator), {
    httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS * 1000
  });
}

function clearSessionCookie(req, res) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure, sameSite: 'strict', path: '/' });
}

module.exports = {
  configured, safeEqual, readSession, csrfFor, requireSession,
  requireCsrf, setSessionCookie, clearSessionCookie
};
