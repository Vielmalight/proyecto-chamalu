import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { fecha, metodo, usuario_id, todas, orden, limite, offset } = req.query;
    const verTodas = todas === '1' || todas === 'true';
    let sql = `SELECT v.*, u.nombre AS usuario_nombre, u.apodo AS usuario_apodo, u.rol AS usuario_rol, c.tipo AS cuenta_tipo, m.numero AS mesa_numero, m.zona AS mesa_zona
               FROM ventas v
               JOIN usuarios u ON u.id = v.usuario_id
               LEFT JOIN cuentas_mesa c ON c.id = v.cuenta_id
               LEFT JOIN mesas m ON m.id = c.mesa_id
               WHERE 1=1`;
    const params = [];
    // Con "Ver todas" se ignora el filtro de día (se ven todos los días)
    if (fecha && !verTodas) { sql += ' AND v.fecha LIKE ?'; params.push(`${fecha}%`); }
    if (metodo) { sql += ' AND v.metodo_pago = ?'; params.push(metodo); }
    if (usuario_id) { sql += ' AND v.usuario_id = ?'; params.push(usuario_id); }
    // "Ver todas" ordena de la más antigua a la más reciente; el resto, de la más reciente primero
    const asc = orden === 'asc' || (verTodas && orden !== 'desc');
    sql += ` ORDER BY v.fecha ${asc ? 'ASC' : 'DESC'}, v.id ${asc ? 'ASC' : 'DESC'}`;
    const lim = parseInt(limite, 10);
    const off = parseInt(offset, 10);
    if (Number.isInteger(lim) && lim > 0) {
      sql += ' LIMIT ?';
      params.push(lim);
      if (Number.isInteger(off) && off >= 0) { sql += ' OFFSET ?'; params.push(off); }
    }
    res.json(await db.prepare(sql).all(...params));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const venta = await db.prepare(`
      SELECT v.*, u.nombre AS usuario_nombre, u.apodo AS usuario_apodo, u.rol AS usuario_rol, c.tipo AS cuenta_tipo, c.cliente AS cliente, m.numero AS mesa_numero, m.zona AS mesa_zona
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN cuentas_mesa c ON c.id = v.cuenta_id
      LEFT JOIN mesas m ON m.id = c.mesa_id
      WHERE v.id = ?
    `).get(req.params.id);
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const items = await db.prepare(`
      SELECT ic.*, p.nombre AS producto_nombre
      FROM items_cuenta ic JOIN productos p ON p.id = ic.producto_id
      WHERE ic.cuenta_id = ? ORDER BY ic.id
    `).all(venta.cuenta_id);
    const subtotal = items.filter((i) => !i.anulado).reduce((sum, i) => sum + i.subtotal, 0);
    res.json({ venta, items, subtotal });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/anular', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { motivo } = req.body || {};
    if (!motivo?.trim()) return res.status(400).json({ error: 'El motivo es obligatorio' });

    const venta = await db.prepare("SELECT * FROM ventas WHERE id = ? AND estado = 'PAGADA'").get(req.params.id);
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada o ya anulada' });

    // Solo se revierten los items que siguen activos (los ya anulados por separado no se tocan)
    const items = await db.prepare('SELECT * FROM items_cuenta WHERE cuenta_id = ? AND anulado = 0').all(venta.cuenta_id);

    await db.transaccion(async (tx) => {
      for (const item of items) {
        const prod = await tx.prepare('SELECT stock_actual FROM productos WHERE id = ?').get(item.producto_id);
        await tx.prepare('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?')
          .run(item.cantidad, item.producto_id);
        await tx.prepare(
          'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(item.producto_id, 'ENTRADA', item.cantidad, prod.stock_actual, prod.stock_actual + item.cantidad, 'Reversión por anulación', req.usuario.id, nowCO());
      }
      await tx.prepare('UPDATE items_cuenta SET anulado = 1 WHERE cuenta_id = ? AND anulado = 0').run(venta.cuenta_id);
      await tx.prepare("UPDATE ventas SET estado = 'ANULADA', motivo_anulacion = ? WHERE id = ?").run(motivo.trim(), venta.id);
    }, { inmediata: true });
    logAuditoria(req, 'ANULAR_VENTA', `Venta #${venta.id} - Motivo: ${motivo.trim()}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al anular la venta', err);
    res.status(500).json({ error: 'Error al anular la venta' });
  }
});

// Anula un solo producto de la venta (solo propietario). Devuelve stock y recalcula el total.
router.post('/:id/items/:itemId/anular', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { motivo } = req.body || {};
    if (!motivo?.trim()) return res.status(400).json({ error: 'El motivo es obligatorio' });

    const venta = await db.prepare("SELECT * FROM ventas WHERE id = ? AND estado = 'PAGADA'").get(req.params.id);
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada o ya anulada' });

    const item = await db.prepare('SELECT * FROM items_cuenta WHERE id = ? AND cuenta_id = ? AND anulado = 0')
      .get(req.params.itemId, venta.cuenta_id);
    if (!item) return res.status(404).json({ error: 'Producto no encontrado o ya anulado' });

    let nuevoTotal;
    let anulada;
    await db.transaccion(async (tx) => {
      // Devolver stock del producto anulado
      const prod = await tx.prepare('SELECT stock_actual FROM productos WHERE id = ?').get(item.producto_id);
      await tx.prepare('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?')
        .run(item.cantidad, item.producto_id);
      await tx.prepare(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(item.producto_id, 'ENTRADA', item.cantidad, prod.stock_actual, prod.stock_actual + item.cantidad, 'Anulación de producto', req.usuario.id, nowCO());

      await tx.prepare('UPDATE items_cuenta SET anulado = 1 WHERE id = ?').run(item.id);

      // Recalcular el total de la venta con los items que siguen activos
      const restante = (await tx.prepare(
        'SELECT COALESCE(SUM(subtotal), 0) AS t FROM items_cuenta WHERE cuenta_id = ? AND anulado = 0'
      ).get(venta.cuenta_id)).t;
      nuevoTotal = Math.max(0, restante - (venta.descuento || 0));
      anulada = restante === 0;

      if (restante === 0) {
        await tx.prepare("UPDATE ventas SET total = 0, estado = 'ANULADA', motivo_anulacion = ? WHERE id = ?")
          .run('Todos los productos fueron anulados', venta.id);
      } else {
        await tx.prepare('UPDATE ventas SET total = ? WHERE id = ?').run(nuevoTotal, venta.id);
      }
    }, { inmediata: true });
    logAuditoria(req, 'ANULAR_ITEM_VENTA', `Venta #${venta.id} - Producto item #${item.id} - Motivo: ${motivo.trim()}`);
    res.json({ ok: true, total: nuevoTotal, anulada });
  } catch (err) {
    console.error('Error al anular el producto', err);
    res.status(500).json({ error: 'Error al anular el producto' });
  }
});

export default router;
