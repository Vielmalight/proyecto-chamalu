import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

// Ventana (minutos) para considerar a un usuario "en línea" (Fase E3)
const MINUTOS_EN_LINEA = 5;

// Minutos transcurridos desde una fecha 'YYYY-MM-DD HH:MM:SS' (hora Colombia)
function minutosDesde(fecha) {
  if (!fecha) return null;
  const ahora = Date.parse(nowCO().replace(' ', 'T') + 'Z');
  const antes = Date.parse(fecha.replace(' ', 'T') + 'Z');
  return Math.max(0, Math.round((ahora - antes) / 60000));
}

router.get('/', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const rows = await db.prepare(`
      SELECT u.id, u.nombre, u.apodo, u.correo, u.usuario, u.rol, u.activo, u.creado_en,
             MAX(s.ultima_actividad) AS ultima_actividad
      FROM usuarios u
      LEFT JOIN sesiones s ON s.usuario_id = u.id
      GROUP BY u.id
    `).all();
    res.json(rows.map((u) => {
      const minutos_inactivo = minutosDesde(u.ultima_actividad);
      return {
        ...u,
        minutos_inactivo,
        en_linea: minutos_inactivo !== null && minutos_inactivo <= MINUTOS_EN_LINEA ? 1 : 0,
      };
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nombre, apodo, correo, usuario, password, rol } = req.body || {};
    if (!nombre?.trim() || !usuario?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'Nombre, usuario y contraseña son obligatorios' });
    }
    if (!['PROPIETARIO', 'CAJERO'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const hash = bcrypt.hashSync(password, 10);
    try {
      const info = await db.prepare('INSERT INTO usuarios (nombre, apodo, correo, usuario, password_hash, rol, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(nombre.trim(), apodo?.trim() || null, correo?.trim() || null, usuario.trim(), hash, rol, nowCO());
      logAuditoria(req, 'CREAR_USUARIO', `${usuario.trim()} (${rol})`);
      res.json({ id: info.lastInsertRowid });
    } catch {
      res.status(409).json({ error: 'Ya existe un usuario o correo registrado' });
    }
  } catch (err) {
    next(err);
  }
});

// Actualizar el propio perfil. Nombre y apodo para todos; usuario y correo solo el propietario.
router.put('/perfil', async (req, res, next) => {
  try {
    const esPropietario = req.usuario.rol === 'PROPIETARIO';
    const { nombre, apodo, usuario, correo } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre obligatorio' });

    const actual = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);

    // El nombre de usuario y el correo solo los cambia el propietario en su propia cuenta
    let nuevoUsuario = actual.usuario;
    let nuevoCorreo = actual.correo;
    if (esPropietario && usuario !== undefined) {
      nuevoUsuario = (usuario || '').trim();
      if (nuevoUsuario.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(nuevoUsuario)) {
        return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres (letras, números, punto, guion o guion bajo)' });
      }
    }
    if (esPropietario && correo !== undefined) {
      nuevoCorreo = (correo || '').trim() || null;
      if (nuevoCorreo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nuevoCorreo)) {
        return res.status(400).json({ error: 'Correo electrónico inválido' });
      }
    }

    try {
      await db.prepare('UPDATE usuarios SET nombre = ?, apodo = ?, usuario = ?, correo = ? WHERE id = ?')
        .run(nombre.trim(), apodo?.trim() || null, nuevoUsuario, nuevoCorreo, req.usuario.id);
    } catch {
      return res.status(409).json({ error: 'Ese usuario o correo ya está en uso' });
    }
    logAuditoria(req, 'EDITAR_PERFIL', `Usuario #${req.usuario.id}`);
    res.json({ ok: true, usuario: nuevoUsuario, correo: nuevoCorreo });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nombre, apodo, correo, rol, activo, password } = req.body || {};
    const actual = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si no envían un campo, se conserva el valor actual
    const nuevoNombre = nombre?.trim() || actual.nombre;
    const nuevoApodo = apodo !== undefined ? (apodo?.trim() || null) : actual.apodo;
    const nuevoCorreo = correo !== undefined ? (correo?.trim() || null) : actual.correo;
    const nuevoRol = rol || actual.rol;
    const nuevoActivo = activo !== undefined ? (activo ? 1 : 0) : actual.activo;

    if (!['PROPIETARIO', 'CAJERO'].includes(nuevoRol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Reglas de protección de propietarios
    const otrosPropietarios = (await db.prepare(
      "SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'PROPIETARIO' AND id != ?"
    ).get(req.params.id)).c;
    if (nuevoRol === 'PROPIETARIO' && nuevoActivo === 0) {
      return res.status(400).json({ error: 'Los propietarios no se pueden desactivar' });
    }
    if (actual.rol === 'PROPIETARIO' && nuevoRol !== 'PROPIETARIO' && otrosPropietarios === 0) {
      return res.status(400).json({ error: 'Debe existir al menos un propietario' });
    }

    await db.prepare('UPDATE usuarios SET nombre = ?, apodo = ?, correo = ?, rol = ?, activo = ? WHERE id = ?')
      .run(nuevoNombre, nuevoApodo, nuevoCorreo, nuevoRol, nuevoActivo, req.params.id);

    // Cambiar contraseña solo si la envían
    if (password?.trim()) {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      await db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?')
        .run(bcrypt.hashSync(password, 10), req.params.id);
    }

    logAuditoria(req, 'EDITAR_USUARIO', `Usuario #${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/cambiar-password', async (req, res, next) => {
  try {
    // El cajero no puede cambiar su propia contraseña: la asigna el propietario
    if (req.usuario.rol !== 'PROPIETARIO') {
      return res.status(403).json({ error: 'Solo el propietario puede cambiar la contraseña' });
    }
    const { password_actual, password_nuevo } = req.body || {};
    if (!password_actual || !password_nuevo?.trim()) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    if (password_nuevo.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }
    const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
    if (!bcrypt.compareSync(password_actual, u.password_hash)) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    const hash = bcrypt.hashSync(password_nuevo, 10);
    await db.prepare('UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?').run(hash, u.id);
    logAuditoria(req, 'CAMBIAR_PASSWORD', `Usuario #${u.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const id = req.params.id;
    if (Number(id) === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Un propietario solo se puede eliminar si queda al menos otro propietario
    if (u.rol === 'PROPIETARIO') {
      const total = (await db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'PROPIETARIO'").get()).c;
      if (total <= 1) {
        return res.status(400).json({ error: 'Debe quedar al menos un propietario' });
      }
    }

    try {
      await db.transaccion(async (tx) => {
        await tx.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
        // Desvinculamos las referencias opcionales (se conserva el registro histórico)
        await tx.prepare('UPDATE movimientos_inventario SET usuario_id = NULL WHERE usuario_id = ?').run(id);
        await tx.prepare('UPDATE movimientos_caja_chica SET usuario_id = NULL WHERE usuario_id = ?').run(id);
        await tx.prepare('UPDATE gastos SET usuario_id = NULL WHERE usuario_id = ?').run(id);
        await tx.prepare('UPDATE logs_auditoria SET usuario_id = NULL WHERE usuario_id = ?').run(id);
        // Si quedan referencias obligatorias (ventas, cuentas o turnos), esto falla y hace rollback
        await tx.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
      }, { inmediata: true });
    } catch {
      return res.status(400).json({ error: 'El usuario tiene historial (ventas, cuentas o caja); desactívalo en su lugar' });
    }

    logAuditoria(req, 'ELIMINAR_USUARIO', `Usuario #${id} (${u.usuario})`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/restablecer-password/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nueva_password } = req.body || {};
    if (!nueva_password?.trim() || nueva_password.length < 6) {
      return res.status(400).json({ error: 'Contraseña inválida (mínimo 6 caracteres)' });
    }
    const hash = bcrypt.hashSync(nueva_password, 10);
    const info = await db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    logAuditoria(req, 'RESTABLECER_PASSWORD', `Usuario #${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
