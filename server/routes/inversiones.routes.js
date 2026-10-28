import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

// Solo propietario
router.use(requireRole('PROPIETARIO'));

router.get('/', async (req, res, next) => {
  try {
    const inversiones = await db.prepare(`
      SELECT i.*, u.nombre AS usuario_nombre
      FROM inversiones i
      LEFT JOIN usuarios u ON u.id = i.usuario_id
      ORDER BY i.fecha DESC, i.id DESC
    `).all();
    res.json(inversiones);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { fecha, descripcion, monto, origen } = req.body || {};
    if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });
    if (!descripcion?.trim()) return res.status(400).json({ error: 'La descripción es obligatoria' });
    if (!Number.isInteger(monto) || monto <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (!['CAJA', 'BOLSILLO'].includes(origen)) return res.status(400).json({ error: 'Origen inválido' });

    let turnoId = null;
    let movCajaId = null;

    if (origen === 'CAJA') {
      const turno = await db.prepare("SELECT * FROM turnos_caja WHERE estado = 'ABIERTA' ORDER BY id DESC LIMIT 1").get();
      if (!turno) return res.status(400).json({ error: 'No hay un turno de caja abierto para descontar de caja' });
      turnoId = turno.id;
    }

    await db.transaccion(async (tx) => {
      if (origen === 'CAJA' && turnoId) {
        const mov = await tx.prepare(
          "INSERT INTO movimientos_caja_chica (turno_id, tipo, monto, descripcion, usuario_id, fecha) VALUES (?, 'SALIDA', ?, ?, ?, ?)"
        ).run(turnoId, monto, `Inversión: ${descripcion.trim()}`, req.usuario.id, nowCO());
        movCajaId = mov.lastInsertRowid;
      }

      await tx.prepare(
        'INSERT INTO inversiones (fecha, descripcion, monto, origen, usuario_id, turno_id, movimiento_caja_chica_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(fecha, descripcion.trim(), monto, origen, req.usuario.id, turnoId, movCajaId);
    }, { inmediata: true });

    logAuditoria(req, 'INVERSION', `Inversión $${monto} - ${descripcion.trim()} (${origen})`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al crear inversión', err);
    res.status(500).json({ error: 'Error al crear la inversión' });
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const inv = await db.prepare('SELECT * FROM inversiones WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Inversión no encontrada' });

    await db.transaccion(async (tx) => {
      if (inv.movimiento_caja_chica_id) {
        await tx.prepare('DELETE FROM movimientos_caja_chica WHERE id = ?').run(inv.movimiento_caja_chica_id);
      }
      await tx.prepare('DELETE FROM inversiones WHERE id = ?').run(inv.id);
    }, { inmediata: true });

    logAuditoria(req, 'INVERSION_ELIMINAR', `Eliminar inversión #${inv.id} $${inv.monto}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar inversión', err);
    res.status(500).json({ error: 'Error al eliminar la inversión' });
  }
});

export default router;
