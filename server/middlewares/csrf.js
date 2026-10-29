import crypto from 'node:crypto';

// Protección CSRF:
// 1) Si el navegador envía el header Origin, debe coincidir con el host del
//    servidor (los clientes que no son navegadores no lo envían).
// 2) En métodos que cambian datos y con sesión activa, se exige el header
//    X-CSRF-Token, derivado de la sesión (HMAC con SESSION_SECRET).
const METODOS_SEGUROS = ['GET', 'HEAD', 'OPTIONS'];

// Rutas que se llaman antes de tener sesión (no pueden llevar token)
const RUTAS_SIN_TOKEN = ['/api/auth/login'];

// Token derivado del token de sesión: no se guarda en la base de datos y
// funciona con varias instancias en Vercel (todas comparten SESSION_SECRET).
export function tokenCsrf(tokenSesion) {
  const secreto = process.env.SESSION_SECRET || '';
  return crypto.createHmac('sha256', secreto).update(String(tokenSesion)).digest('hex');
}

export function verificarOrigen(req, res, next) {
  if (METODOS_SEGUROS.includes(req.method)) return next();

  const origin = req.get('Origin');
  if (!origin) return next();

  let origenHost;
  try {
    origenHost = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Origen no permitido' });
  }

  if (origenHost === req.get('Host')) return next();
  return res.status(403).json({ error: 'Origen no permitido' });
}

export function verificarTokenCsrf(req, res, next) {
  if (METODOS_SEGUROS.includes(req.method)) return next();
  if (RUTAS_SIN_TOKEN.includes(req.path)) return next();

  const tokenSesion = req.cookies?.sid;
  if (!tokenSesion) return next(); // sin sesión lo resuelve requireAuth

  const esperado = Buffer.from(tokenCsrf(tokenSesion));
  const recibido = Buffer.from(req.get('X-CSRF-Token') || '');
  if (esperado.length !== recibido.length || !crypto.timingSafeEqual(esperado, recibido)) {
    return res.status(403).json({ error: 'Token CSRF inválido' });
  }
  next();
}
