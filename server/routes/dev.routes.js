import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { nowCO, sumarMinutos } from '../config/constants.js';
import { tokenCsrf } from '../middlewares/csrf.js';
import { devLoginLimiter } from '../middlewares/rateLimit.js';
import {
  escaparHtml,
  obtenerEstadoLicencia,
  invalidarCacheLicencia,
} from '../middlewares/licencia.js';

// Panel privado del desarrollador.
// Es independiente de la tabla `usuarios` del bar: usa DEV_USER y
// DEV_PASSWORD_HASH (variables de entorno) y su propia cookie `dev_sid`.
const router = Router();

const COOKIE = 'dev_sid';
const MAX_MENSAJE = 300;
const MENSAJE_POR_DEFECTO = 'Estamos realizando mantenimiento. Volvemos pronto.';

// Hash de relleno: si el usuario no coincide, igual se ejecuta bcrypt.compare
// para no revelar por tiempo si el usuario existe.
const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', 10);

function configPanel() {
  const timeout = Number(process.env.DEV_SESSION_TIMEOUT_MIN);
  return {
    usuario: process.env.DEV_USER || '',
    hash: process.env.DEV_PASSWORD_HASH || '',
    configurado: Boolean(process.env.DEV_USER && process.env.DEV_PASSWORD_HASH),
    timeoutMin: Number.isFinite(timeout) && timeout >= 5 && timeout <= 720 ? timeout : 60,
  };
}

function esProduccion() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function opcionesCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: esProduccion(),
    path: '/panel-dev',
  };
}

function tokenDeSesion(req) {
  return req.cookies?.[COOKIE] || '';
}

function tokenCsrfPanel(req) {
  return tokenCsrf(tokenDeSesion(req));
}

function csrfValido(req) {
  const esperado = Buffer.from(tokenCsrfPanel(req));
  const recibido = Buffer.from(String(req.body?._csrf || ''));
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

// Busca la sesión de la cookie, borra la expirada y renueva la actividad
async function sesionActual(req) {
  const token = tokenDeSesion(req);
  if (!token) return null;

  const sesion = await db.prepare('SELECT * FROM sesiones_dev WHERE token = ?').get(token);
  if (!sesion) return null;

  if (sesion.expira_en < nowCO()) {
    await db.prepare('DELETE FROM sesiones_dev WHERE token = ?').run(token);
    return null;
  }

  const ahora = nowCO();
  await db.prepare('UPDATE sesiones_dev SET ultima_actividad = ?, expira_en = ? WHERE token = ?')
    .run(ahora, sumarMinutos(ahora, configPanel().timeoutMin), token);
  return sesion;
}

async function crearSesion() {
  const token = crypto.randomBytes(32).toString('hex');
  const ahora = nowCO();
  await db.prepare(
    'INSERT INTO sesiones_dev (token, creado_en, ultima_actividad, expira_en) VALUES (?, ?, ?, ?)'
  ).run(token, ahora, ahora, sumarMinutos(ahora, configPanel().timeoutMin));
  return token;
}

function pagina(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escaparHtml(titulo)}</title>
<link rel="stylesheet" href="/css/variables.css">
<link rel="stylesheet" href="/css/panel-dev.css">
</head>
<body class="panel-dev">
${cuerpo}
</body>
</html>`;
}

function enviarHtml(res, html, status = 200) {
  res.set('Cache-Control', 'no-store');
  return res.status(status).type('html').send(html);
}

function renderLogin(res, error = '', status = 200) {
  return enviarHtml(res, pagina('Panel del desarrollador', `
  <main class="panel-card">
    <h1>Panel del desarrollador</h1>
    <p class="panel-muted">Acceso privado. No es el acceso del bar.</p>
    ${error ? `<div class="panel-error">${escaparHtml(error)}</div>` : ''}
    <form method="post" action="/panel-dev/login" class="panel-form">
      <label>Usuario
        <input name="usuario" autocomplete="username" required autofocus>
      </label>
      <label>Contraseña
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <button class="panel-btn panel-btn-primary" type="submit">Entrar</button>
    </form>
  </main>`), status);
}

async function renderPanel(req, res) {
  const lic = await obtenerEstadoLicencia({ forzar: true });
  const historial = await db.prepare(
    'SELECT fecha, estado_anterior, estado_nuevo, mensaje FROM licencia_historial ORDER BY id DESC LIMIT 50'
  ).all();
  const suspendida = lic.estado === 'suspendida';
  const csrf = tokenCsrfPanel(req);

  const accion = suspendida
    ? `<form method="post" action="/panel-dev/estado" class="panel-form"
         onsubmit="return confirm('¿Habilitar el servicio? La web volverá a funcionar de inmediato.')">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="accion" value="habilitar">
        <p class="panel-mensaje">Mensaje actual: ${escaparHtml(lic.mensaje || 'Sin mensaje')}</p>
        <button class="panel-btn panel-btn-primary" type="submit">Habilitar servicio</button>
      </form>`
    : `<form method="post" action="/panel-dev/estado" class="panel-form"
         onsubmit="return confirm('¿Suspender el servicio? La web dejará de funcionar hasta que lo habilites.')">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="accion" value="suspender">
        <label>Mensaje de suspensión (opcional)
          <textarea name="mensaje" rows="3" maxlength="${MAX_MENSAJE}"
            placeholder="Ej.: Estamos realizando mantenimiento. Volvemos pronto."></textarea>
        </label>
        <button class="panel-btn panel-btn-danger" type="submit">Suspender servicio</button>
      </form>`;

  const filas = historial.map((h) => `
    <tr>
      <td>${escaparHtml(h.fecha)}</td>
      <td>${escaparHtml(h.estado_anterior)} &rarr; ${escaparHtml(h.estado_nuevo)}</td>
      <td>${escaparHtml(h.mensaje || '')}</td>
    </tr>`).join('');

  return enviarHtml(res, pagina('Panel del desarrollador', `
  <main class="panel-card panel-card-wide">
    <header class="panel-head">
      <h1>Panel del desarrollador</h1>
      <form method="post" action="/panel-dev/logout">
        <input type="hidden" name="_csrf" value="${csrf}">
        <button class="panel-btn" type="submit">Salir</button>
      </form>
    </header>

    <section class="panel-estado ${suspendida ? 'panel-estado-off' : 'panel-estado-on'}">
      <span class="panel-badge">${suspendida ? 'Suspendida' : 'Activa'}</span>
      <p class="panel-muted">Último cambio: ${escaparHtml(lic.fecha_cambio || 'sin registro')}</p>
    </section>

    ${accion}

    <h2>Historial de cambios</h2>
    ${historial.length === 0
      ? '<p class="panel-muted">Sin cambios registrados.</p>'
      : `<div class="panel-tabla-wrap">
          <table class="panel-tabla">
            <thead><tr><th>Fecha</th><th>Cambio</th><th>Mensaje</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>`}
  </main>`));
}

// Todo el panel responde 404 si no está configurado (no revela que existe)
router.use((req, res, next) => {
  if (!configPanel().configurado) {
    return res.status(404).type('text/plain').send('No encontrado');
  }
  next();
});

async function requiereSesionDev(req, res, next) {
  try {
    const sesion = await sesionActual(req);
    if (!sesion) {
      if (req.method === 'GET') return renderLogin(res);
      return res.status(401).type('text/plain').send('Sesión no válida');
    }
    req.devSesion = sesion;
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/', requiereSesionDev, async (req, res, next) => {
  try {
    await renderPanel(req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/login', devLoginLimiter, async (req, res, next) => {
  try {
    const { usuario = '', password = '' } = req.body || {};
    const cfg = configPanel();

    let claveOk = false;
    try {
      claveOk = await bcrypt.compare(String(password), cfg.hash || HASH_FALSO);
    } catch {
      claveOk = false;
    }

    if (String(usuario) !== cfg.usuario || !claveOk) {
      return renderLogin(res, 'Credenciales incorrectas', 401);
    }

    await db.prepare('DELETE FROM sesiones_dev WHERE expira_en < ?').run(nowCO());
    const token = await crearSesion();
    res.cookie(COOKIE, token, opcionesCookie());
    return res.redirect(303, '/panel-dev');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requiereSesionDev, async (req, res, next) => {
  try {
    if (!csrfValido(req)) return res.status(403).type('text/plain').send('Token CSRF inválido');
    await db.prepare('DELETE FROM sesiones_dev WHERE token = ?').run(tokenDeSesion(req));
    res.clearCookie(COOKIE, { path: '/panel-dev' });
    return res.redirect(303, '/panel-dev');
  } catch (err) {
    next(err);
  }
});

router.post('/estado', requiereSesionDev, async (req, res, next) => {
  try {
    if (!csrfValido(req)) return res.status(403).type('text/plain').send('Token CSRF inválido');

    const accion = String(req.body?.accion || '');
    if (accion !== 'suspender' && accion !== 'habilitar') {
      return res.status(400).type('text/plain').send('Acción no válida');
    }

    let mensaje = String(req.body?.mensaje || '').trim().slice(0, MAX_MENSAJE);
    const nuevo = accion === 'suspender' ? 'suspendida' : 'activa';
    if (nuevo === 'suspendida' && !mensaje) mensaje = MENSAJE_POR_DEFECTO;
    if (nuevo === 'activa') mensaje = null;

    let anterior = 'activa';
    await db.transaccion(async (tx) => {
      const actual = await tx.prepare('SELECT estado FROM licencia WHERE id = 1').get();
      anterior = actual?.estado || 'activa';
      const ahora = nowCO();
      await tx.prepare('UPDATE licencia SET estado = ?, mensaje = ?, fecha_cambio = ? WHERE id = 1')
        .run(nuevo, mensaje, ahora);
      await tx.prepare(
        'INSERT INTO licencia_historial (fecha, estado_anterior, estado_nuevo, mensaje) VALUES (?, ?, ?, ?)'
      ).run(ahora, anterior, nuevo, mensaje);
    }, { inmediata: true });

    invalidarCacheLicencia();
    console.log(`[licencia] ${anterior} -> ${nuevo}`);
    return res.redirect(303, '/panel-dev');
  } catch (err) {
    next(err);
  }
});

// Cualquier otra ruta bajo /panel-dev
router.use((req, res) => res.status(404).type('text/plain').send('No encontrado'));

// Error interno del panel (sin detalles al navegador)
router.use((err, req, res, next) => {
  console.error('[panel-dev]', err);
  if (res.headersSent) return next(err);
  return res.status(500).type('text/plain').send('Error interno');
});

export default router;
