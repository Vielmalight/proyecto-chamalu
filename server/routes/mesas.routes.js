import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.prepare('SELECT * FROM mesas ORDER BY zona, numero').all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { numero, zona, nombre_cliente } = req.body || {};
    if (!Number.isInteger(numero) || numero <= 0) {
      return res.status(400).json({ error: 'Número de mesa inválido' });
    }
    const zonaLimpia = (zona || '').trim();
    try {
      const info = await db.prepare('INSERT INTO mesas (numero, zona, nombre_cliente) VALUES (?, ?, ?)')
        .run(numero, zonaLimpia, nombre_cliente?.trim() || null);
      logAuditoria(req, 'CREAR_MESA', `${zonaLimpia ? zonaLimpia + ' ' : 'Mesa '}${numero}`);
      res.json({ id: info.lastInsertRowid });
    } catch {
      res.status(409).json({ error: 'Ya existe una mesa con ese número en esa zona' });
    }
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { numero, zona, nombre_cliente } = req.body || {};
    if (!Number.isInteger(numero) || numero <= 0) {
      return res.status(400).json({ error: 'Número de mesa inválido' });
    }
    const zonaLimpia = (zona || '').trim();
    try {
      const info = await db.prepare('UPDATE mesas SET numero = ?, zona = ?, nombre_cliente = ? WHERE id = ?')
        .run(numero, zonaLimpia, nombre_cliente?.trim() || null, req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'Mesa no encontrada' });
    } catch {
      return res.status(409).json({ error: 'Ya existe una mesa con ese número en esa zona' });
    }
    logAuditoria(req, 'EDITAR_MESA', `Mesa ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const mesa = await db.prepare('SELECT * FROM mesas WHERE id = ?').get(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const cuentas = (await db.prepare('SELECT COUNT(*) AS c FROM cuentas_mesa WHERE mesa_id = ?').get(mesa.id)).c;
    if (cuentas > 0) {
      return res.status(400).json({ error: 'No se puede eliminar: la mesa tiene cuentas asociadas. Ciérralas o usa otra mesa.' });
    }
    if (mesa.estado === 'OCUPADA') {
      return res.status(400).json({ error: 'No se puede eliminar una mesa ocupada' });
    }

    try {
      await db.prepare('DELETE FROM mesas WHERE id = ?').run(mesa.id);
    } catch {
      return res.status(400).json({ error: 'No se pudo eliminar la mesa' });
    }
    logAuditoria(req, 'ELIMINAR_MESA', `Mesa ${mesa.numero}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/abrir', async (req, res, next) => {
  try {
    const mesa = await db.prepare('SELECT * FROM mesas WHERE id = ?').get(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (mesa.estado === 'OCUPADA') return res.status(409).json({ error: 'La mesa ya está ocupada' });

    const cuenta = await db.prepare(
      'INSERT INTO cuentas_mesa (mesa_id, usuario_id, apertura_en) VALUES (?, ?, ?)'
    ).run(mesa.id, req.usuario.id, nowCO());

    await db.prepare("UPDATE mesas SET estado = 'OCUPADA' WHERE id = ?").run(mesa.id);
    logAuditoria(req, 'ABRIR_MESA', `Mesa ${mesa.numero}`);
    res.json({ cuenta_id: cuenta.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

// Devuelve la cuenta abierta de una mesa con sus items y total
router.get('/:id/cuenta', async (req, res, next) => {
  try {
    const cuenta = await db.prepare(
      "SELECT * FROM cuentas_mesa WHERE mesa_id = ? AND estado = 'ABIERTA' ORDER BY id DESC LIMIT 1"
    ).get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'No hay cuenta abierta para esta mesa' });

    const items = await db.prepare(`
      SELECT ic.*, p.nombre AS producto_nombre
      FROM items_cuenta ic JOIN productos p ON p.id = ic.producto_id
      WHERE ic.cuenta_id = ? ORDER BY ic.id
    `).all(cuenta.id);
    const total = items.reduce((sum, i) => sum + i.subtotal, 0);
    const mesa = await db.prepare('SELECT * FROM mesas WHERE id = ?').get(cuenta.mesa_id);
    res.json({ cuenta, items, total, mesa });
  } catch (err) {
    next(err);
  }
});

export default router;
