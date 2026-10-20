import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';

// Verifica que haya una sesión activa y válida. Si no, responde 401.
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.sid;
    if (!token) return res.status(401).json({ error: 'No autenticado' });

    const sesion = await db.prepare('SELECT * FROM sesiones WHERE token = ?').get(token);
    if (!sesion) return res.status(401).json({ error: 'Sesión inválida' });

    if (sesion.expira_en < nowCO()) {
      await db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
      return res.status(401).json({ error: 'Sesión expirada por inactividad' });
    }

    const usuario = await db.prepare(
      'SELECT id, nombre, apodo, correo, usuario, rol, activo, debe_cambiar_password FROM usuarios WHERE id = ?'
    ).get(sesion.usuario_id);

    if (!usuario || !usuario.activo) {
      await db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
      return res.status(401).json({ error: 'Usuario desactivado' });
    }

    await db.prepare('UPDATE sesiones SET ultima_actividad = ? WHERE token = ?').run(nowCO(), token);

    req.usuario = usuario;
    req.sesionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

// Si el usuario debe cambiar su contraseña (admin inicial), solo se le permite
// cambiarla o editar su perfil. El resto de la API queda bloqueada.
const RUTAS_PERMITIDAS_TEMPORAL = ['/usuarios/cambiar-password', '/usuarios/perfil'];
export function bloquearSiDebeCambiarPassword(req, res, next) {
  if (req.usuario?.debe_cambiar_password && !RUTAS_PERMITIDAS_TEMPORAL.includes(req.path)) {
    return res.status(403).json({
      error: 'Debes cambiar tu contraseña antes de continuar',
      debe_cambiar_password: true,
    });
  }
  next();
}
