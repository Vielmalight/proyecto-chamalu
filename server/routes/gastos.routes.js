import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { fecha } = req.query;
    let sql = 'SELECT g.*, u.nombre AS usuario_nombre FROM gastos g LEFT JOIN usuarios u ON u.id = g.usuario_id WHERE 1=1';
    const params = [];
    if (fecha) { sql += ' AND g.fecha LIKE ?'; params.push(`${fecha}%`); }
    sql += ' ORDER BY g.fecha DESC';
    res.json(await db.prepare(sql).all(...params));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { descripcion, monto, categoria } = req.body || {};
    if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción obligatoria' });
    if (!Number.isInteger(monto) || monto <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (!categoria?.trim()) return res.status(400).json({ error: 'Categoría obligatoria' });

    const info = await db.prepare('INSERT INTO gastos (descripcion, monto, categoria, usuario_id, fecha) VALUES (?, ?, ?, ?, ?)')
      .run(descripcion.trim(), monto, categoria.trim(), req.usuario.id, nowCO());
    logAuditoria(req, 'GASTO', `${descripcion.trim()} - $${monto}`);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const info = await db.prepare('DELETE FROM gastos WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Gasto no encontrado' });
    logAuditoria(req, 'ELIMINAR_GASTO', `Gasto #${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
