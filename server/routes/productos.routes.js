import { Router } from 'express';
import { db } from '../config/db.js';
import { subirImagen, normalizarImagen } from '../config/almacen.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

// Lista productos. El cajero NO recibe precio_compra.
router.get('/', async (req, res, next) => {
  try {
    const { buscar, categoria } = req.query;
    let sql = `SELECT p.*, c.nombre AS categoria_nombre
               FROM productos p
               LEFT JOIN categorias c ON c.id = p.categoria_id
               WHERE p.activo = 1`;
    const params = [];
    if (buscar) {
      sql += ' AND p.nombre LIKE ?';
      params.push(`%${buscar}%`);
    }
    if (categoria) {
      sql += ' AND p.categoria_id = ?';
      params.push(categoria);
    }
    sql += ' ORDER BY p.nombre';
    let rows = await db.prepare(sql).all(...params);
    rows = rows.map((p) => ({ ...p, imagen_url: normalizarImagen(p.imagen_url) }));
    if (req.usuario.rol === 'CAJERO') {
      rows = rows.map(({ precio_compra, ...rest }) => rest);
    }
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Crear producto (solo propietario)
router.post('/', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nombre, categoria_id, precio_compra, precio_venta, stock_actual, stock_minimo, unidad_medida, imagen_base64, precio_pendiente } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const esPendiente = precio_pendiente === true || precio_pendiente === 1 ? 1 : 0;
    const pv = Number(precio_venta);
    if (esPendiente) {
      if (pv !== 0 && !Number.isInteger(pv)) {
        return res.status(400).json({ error: 'Precio inválido' });
      }
    } else {
      if (!Number.isInteger(pv) || pv <= 0) {
        return res.status(400).json({ error: 'El precio de venta debe ser un entero positivo' });
      }
    }

    let imagen_url = null;
    if (imagen_base64) {
      try {
        imagen_url = await subirImagen(imagen_base64);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    const info = await db.prepare(
      `INSERT INTO productos (nombre, categoria_id, imagen_url, precio_compra, precio_venta, stock_actual, stock_minimo, unidad_medida, precio_pendiente)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nombre.trim(),
      categoria_id || null,
      imagen_url,
      Math.max(0, parseInt(precio_compra, 10) || 0),
      esPendiente ? 0 : pv,
      Math.max(0, parseInt(stock_actual, 10) || 0),
      Math.max(0, parseInt(stock_minimo, 10) || 0),
      unidad_medida || 'unidad',
      esPendiente
    );
    logAuditoria(req, 'CREAR_PRODUCTO', `${nombre.trim()} (venta: ${esPendiente ? 'PENDIENTE' : '$' + pv})`);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

// Editar producto (solo propietario)
router.put('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nombre, categoria_id, precio_compra, precio_venta, stock_actual, stock_minimo, unidad_medida, imagen_base64, precio_pendiente } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const esPendiente = precio_pendiente === true || precio_pendiente === 1 ? 1 : 0;
    const pv = Number(precio_venta);
    if (esPendiente) {
      if (pv !== 0 && !Number.isInteger(pv)) {
        return res.status(400).json({ error: 'Precio inválido' });
      }
    } else {
      if (!Number.isInteger(pv) || pv <= 0) {
        return res.status(400).json({ error: 'El precio de venta debe ser un entero positivo' });
      }
    }

    let imagen_url;
    if (imagen_base64) {
      try {
        imagen_url = await subirImagen(imagen_base64);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    const baseSql = imagen_url
      ? `UPDATE productos SET nombre=?, categoria_id=?, imagen_url=?, precio_compra=?, precio_venta=?, stock_actual=?, stock_minimo=?, unidad_medida=?, precio_pendiente=? WHERE id=? AND activo=1`
      : `UPDATE productos SET nombre=?, categoria_id=?, precio_compra=?, precio_venta=?, stock_actual=?, stock_minimo=?, unidad_medida=?, precio_pendiente=? WHERE id=? AND activo=1`;
    const paramsBase = [
      nombre.trim(),
      categoria_id || null,
      Math.max(0, parseInt(precio_compra, 10) || 0),
      esPendiente ? 0 : pv,
      Math.max(0, parseInt(stock_actual, 10) || 0),
      Math.max(0, parseInt(stock_minimo, 10) || 0),
      unidad_medida || 'unidad',
      esPendiente
    ];
    const sql = imagen_url ? `UPDATE productos SET nombre=?, categoria_id=?, imagen_url=?, precio_compra=?, precio_venta=?, stock_actual=?, stock_minimo=?, unidad_medida=?, precio_pendiente=? WHERE id=? AND activo=1` : baseSql;
    const params = imagen_url
      ? [nombre.trim(), categoria_id || null, imagen_url, Math.max(0, parseInt(precio_compra, 10) || 0), esPendiente ? 0 : pv, Math.max(0, parseInt(stock_actual, 10) || 0), Math.max(0, parseInt(stock_minimo, 10) || 0), unidad_medida || 'unidad', esPendiente, req.params.id]
      : [nombre.trim(), categoria_id || null, Math.max(0, parseInt(precio_compra, 10) || 0), esPendiente ? 0 : pv, Math.max(0, parseInt(stock_actual, 10) || 0), Math.max(0, parseInt(stock_minimo, 10) || 0), unidad_medida || 'unidad', esPendiente, req.params.id];
    const anterior = await db.prepare('SELECT nombre, precio_venta FROM productos WHERE id = ? AND activo = 1').get(req.params.id);
    const info = await db.prepare(sql).run(...params);
    if (info.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    const cambioPrecio = anterior && !esPendiente && anterior.precio_venta !== pv
      ? ` | precio venta: $${anterior.precio_venta} -> $${pv}`
      : (esPendiente ? ' | marcado como precio pendiente' : '');
    logAuditoria(req, 'EDITAR_PRODUCTO', `${nombre.trim()}${cambioPrecio}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Eliminar producto (soft delete, solo propietario)
router.delete('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const info = await db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    logAuditoria(req, 'DESACTIVAR_PRODUCTO', `Producto #${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
