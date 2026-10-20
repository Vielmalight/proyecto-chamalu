import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

router.get('/movimientos', async (req, res, next) => {
  try {
    const { producto_id, tipo } = req.query;
    let sql = `
      SELECT m.*, p.nombre AS producto_nombre, u.nombre AS usuario_nombre
      FROM movimientos_inventario m
      JOIN productos p ON p.id = m.producto_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE 1=1`;
    const params = [];
    if (producto_id) { sql += ' AND m.producto_id = ?'; params.push(producto_id); }
    if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }
    sql += ' ORDER BY m.fecha DESC';
    res.json(await db.prepare(sql).all(...params));
  } catch (err) {
    next(err);
  }
});

router.post('/entrada', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { producto_id, cantidad, motivo } = req.body || {};
    if (!Number.isInteger(producto_id) || !Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    const producto = await db.prepare('SELECT * FROM productos WHERE id = ?').get(producto_id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const stockNuevo = producto.stock_actual + cantidad;
    await db.transaccion(async (tx) => {
      await tx.prepare('UPDATE productos SET stock_actual = ? WHERE id = ?').run(stockNuevo, producto_id);
      await tx.prepare(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(producto_id, 'ENTRADA', cantidad, producto.stock_actual, stockNuevo, motivo?.trim() || 'Entrada manual', req.usuario.id, nowCO());
    }, { inmediata: true });
    logAuditoria(req, 'INVENTARIO_ENTRADA', `${producto.nombre} +${cantidad}`);
    res.json({ ok: true, stock_nuevo: stockNuevo });
  } catch (err) {
    console.error('Error al registrar entrada', err);
    res.status(500).json({ error: 'Error al registrar entrada' });
  }
});

router.post('/salida', async (req, res, next) => {
  try {
    const { producto_id, cantidad, motivo } = req.body || {};
    if (!Number.isInteger(producto_id) || !Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    if (!motivo?.trim()) return res.status(400).json({ error: 'El motivo es obligatorio para salidas' });

    const producto = await db.prepare('SELECT * FROM productos WHERE id = ?').get(producto_id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    if (producto.stock_actual < cantidad) {
      return res.status(400).json({ error: 'Stock insuficiente' });
    }

    const stockNuevo = producto.stock_actual - cantidad;
    await db.transaccion(async (tx) => {
      await tx.prepare('UPDATE productos SET stock_actual = ? WHERE id = ?').run(stockNuevo, producto_id);
      await tx.prepare(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(producto_id, 'SALIDA', cantidad, producto.stock_actual, stockNuevo, motivo.trim(), req.usuario.id, nowCO());
    }, { inmediata: true });
    logAuditoria(req, 'INVENTARIO_SALIDA', `${producto.nombre} -${cantidad} (${motivo.trim()})`);
    res.json({ ok: true, stock_nuevo: stockNuevo });
  } catch (err) {
    console.error('Error al registrar salida', err);
    res.status(500).json({ error: 'Error al registrar salida' });
  }
});

export default router;
