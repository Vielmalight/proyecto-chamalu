import { Router } from 'express';
import { db } from '../config/db.js';
import { requireRole } from '../middlewares/roles.js';

const router = Router();

// Los reportes son solo para el propietario
router.use(requireRole('PROPIETARIO'));

function fechaValida(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Resumen de ventas en un rango de fechas
router.get('/', async (req, res, next) => {
  try {
    const desde = fechaValida(req.query.desde);
    const hasta = fechaValida(req.query.hasta);

    const filtros = ["v.estado = 'PAGADA'"];
    const params = [];
    if (desde) { filtros.push('v.fecha >= ?'); params.push(`${desde} 00:00:00`); }
    if (hasta) { filtros.push('v.fecha <= ?'); params.push(`${hasta} 23:59:59`); }
    const where = filtros.join(' AND ');

    const resumen = await db.prepare(`
      SELECT COALESCE(SUM(v.total), 0) AS total,
             COUNT(*) AS cantidad,
             COALESCE(SUM(v.descuento), 0) AS descuentos,
             COALESCE(SUM(v.propina), 0) AS propinas
      FROM ventas v WHERE ${where}
    `).get(...params);

    const por_metodo = await db.prepare(`
      SELECT v.metodo_pago, COALESCE(SUM(v.total), 0) AS total, COUNT(*) AS cantidad
      FROM ventas v WHERE ${where}
      GROUP BY v.metodo_pago ORDER BY total DESC
    `).all(...params);

    const por_usuario = await db.prepare(`
      SELECT u.nombre AS usuario, COALESCE(SUM(v.total), 0) AS total, COUNT(*) AS cantidad
      FROM ventas v JOIN usuarios u ON u.id = v.usuario_id WHERE ${where}
      GROUP BY v.usuario_id ORDER BY u.id
    `).all(...params);

    const top_productos = await db.prepare(`
      SELECT p.nombre AS producto, SUM(ic.cantidad) AS cantidad, SUM(ic.subtotal) AS total
      FROM ventas v
      JOIN items_cuenta ic ON ic.cuenta_id = v.cuenta_id AND ic.anulado = 0
      JOIN productos p ON p.id = ic.producto_id
      WHERE ${where}
      GROUP BY ic.producto_id ORDER BY total DESC LIMIT 10
    `).all(...params);

    res.json({ desde, hasta, resumen, por_metodo, por_usuario, top_productos });
  } catch (err) {
    next(err);
  }
});

export default router;
