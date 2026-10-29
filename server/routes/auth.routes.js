import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from '../config/db.js';
import { nowCO, sumarMinutos, MODULOS_POR_ROL } from '../config/constants.js';
import { APP_VERSION } from '../config/version.js';
import { loginLimiter } from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/auth.js';
import { tokenCsrf } from '../middlewares/csrf.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

function publicUser(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    apodo: u.apodo,
    correo: u.correo,
    usuario: u.usuario,
    rol: u.rol,
    debe_cambiar_password: u.debe_cambiar_password ? true : false,
  };
}

// Datos que el frontend necesita al iniciar sesión
async function datosSesion(u, tokenSesion) {
  const modulos = MODULOS_POR_ROL[u.rol] || [];
  const nombre = await db.prepare("SELECT valor FROM configuracion WHERE clave = 'nombre_negocio'").get();
  const logo = await db.prepare("SELECT valor FROM configuracion WHERE clave = 'logo'").get();
  const turno = await db.prepare("SELECT * FROM turnos_caja WHERE estado = 'ABIERTA' ORDER BY id DESC LIMIT 1").get();
  return {
    usuario: publicUser(u),
    modulos,
    version: APP_VERSION,
    csrf_token: tokenCsrf(tokenSesion),
    config: {
      nombre_negocio: nombre?.valor || 'Chamalú Beer',
      logo: logo?.valor || '',
    },
    turno_caja: turno || null,
  };
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const u = await db.prepare('SELECT * FROM usuarios WHERE usuario = ? OR correo = ?').get(usuario, usuario);
    if (!u) {
      logAuditoria(req, 'LOGIN_FALLIDO', `Usuario inexistente: ${String(usuario).slice(0, 50)}`);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    if (!u.activo) {
      logAuditoria(req, 'LOGIN_FALLIDO', `Usuario desactivado: ${u.usuario}`, u.id);
      return res.status(401).json({ error: 'Usuario desactivado' });
    }

    const ok = bcrypt.compareSync(password, u.password_hash);
    if (!ok) {
      logAuditoria(req, 'LOGIN_FALLIDO', `Contraseña incorrecta: ${u.usuario}`, u.id);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const timeoutMin = parseInt(process.env.SESSION_TIMEOUT_MIN || '120', 10);
    const ahora = nowCO();
    const expira = sumarMinutos(ahora, timeoutMin);

    await db.prepare(
      'INSERT INTO sesiones (token, usuario_id, creado_en, ultima_actividad, expira_en) VALUES (?, ?, ?, ?, ?)'
    ).run(token, u.id, ahora, ahora, expira);

    res.cookie('sid', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: timeoutMin * 60 * 1000,
    });

    logAuditoria(req, 'LOGIN', `Ingreso: ${u.usuario} (${u.rol})`, u.id);
    res.json(await datosSesion(u, token));
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.sid;
    if (token) await db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
    res.clearCookie('sid');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await datosSesion(req.usuario, req.sesionToken));
  } catch (err) {
    next(err);
  }
});

export default router;
