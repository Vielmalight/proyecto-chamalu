import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

const METODOS_VALIDOS = ['EFECTIVO', 'DATAFONO', 'TRANSFERENCIA', 'NEQUI'];

// Error de negocio: se responde con su estado HTTP y no se confunde con error de servidor
function errorNegocio(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Devuelve la cuenta con sus items, total y mesa (o null si es de mostrador)
async function cuentaConItems(id) {
  const cuenta = await db.prepare('SELECT * FROM cuentas_mesa WHERE id = ?').get(id);
  if (!cuenta) return null;
  const items = await db.prepare(`
    SELECT ic.*, p.nombre AS producto_nombre, p.imagen_url
    FROM items_cuenta ic
    JOIN productos p ON p.id = ic.producto_id
    WHERE ic.cuenta_id = ?
    ORDER BY ic.id
  `).all(cuenta.id);
  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  const mesa = cuenta.mesa_id
    ? await db.prepare('SELECT * FROM mesas WHERE id = ?').get(cuenta.mesa_id)
    : null;
  return { cuenta, items, total, mesa };
}

// Rebaja el stock de un producto y deja el movimiento (dentro de la transacción tx)
async function descontarStock(tx, producto, cantidad, motivo, usuarioId) {
  const nuevo = producto.stock_actual - cantidad;
  await tx.prepare('UPDATE productos SET stock_actual = ? WHERE id = ?').run(nuevo, producto.id);
  await tx.prepare(
    'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(producto.id, 'SALIDA', cantidad, producto.stock_actual, nuevo, motivo, usuarioId, nowCO());
  return nuevo;
}

// Devuelve stock a un producto y deja el movimiento (dentro de la transacción tx)
async function devolverStock(tx, productoId, cantidad, motivo, usuarioId) {
  const producto = await tx.prepare('SELECT stock_actual FROM productos WHERE id = ?').get(productoId);
  const nuevo = producto.stock_actual + cantidad;
  await tx.prepare('UPDATE productos SET stock_actual = ? WHERE id = ?').run(nuevo, productoId);
  await tx.prepare(
    'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(productoId, 'ENTRADA', cantidad, producto.stock_actual, nuevo, motivo, usuarioId, nowCO());
  return nuevo;
}

// Manejador estándar de errores: los de negocio (e.status) se responden tal cual
function manejarError(res, err, mensajeServidor) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(mensajeServidor, err);
  return res.status(500).json({ error: mensajeServidor });
}

// Lista de cuentas (todas o solo las abiertas = "pendientes por cobrar")
router.get('/', async (req, res, next) => {
  try {
    const { estado } = req.query;
    let sql = `SELECT c.*, m.numero AS mesa_numero, m.zona AS mesa_zona, m.nombre_cliente AS mesa_cliente, u.nombre AS usuario_nombre
               FROM cuentas_mesa c
               LEFT JOIN mesas m ON m.id = c.mesa_id
               LEFT JOIN usuarios u ON u.id = c.usuario_id`;
    const params = [];
    if (estado) {
      sql += ' WHERE c.estado = ?';
      params.push(estado);
    }
    sql += ' ORDER BY c.id DESC';
    const cuentas = await db.prepare(sql).all(...params);
    const totales = await db.prepare(
      'SELECT cuenta_id, SUM(subtotal) AS total FROM items_cuenta GROUP BY cuenta_id'
    ).all();
    const mapa = Object.fromEntries(totales.map((t) => [t.cuenta_id, t.total]));
    res.json(cuentas.map((c) => ({ ...c, total: mapa[c.id] || 0 })));
  } catch (err) {
    next(err);
  }
});

// Abrir una cuenta nueva: con mesa (tipo MESA) o sin mesa (tipo MOSTRADOR)
router.post('/', async (req, res, next) => {
  try {
    const { mesa_id, cliente } = req.body || {};
    const clienteLimpio = cliente?.trim() || null;

    if (mesa_id != null) {
      const mesa = await db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesa_id);
      if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
      const abierta = await db.prepare("SELECT id FROM cuentas_mesa WHERE mesa_id = ? AND estado = 'ABIERTA'").get(mesa_id);
      if (abierta) return res.status(409).json({ error: 'La mesa ya tiene una cuenta abierta', cuenta_id: abierta.id });

      let cuentaId;
      await db.transaccion(async (tx) => {
        const cuenta = await tx.prepare(
          "INSERT INTO cuentas_mesa (mesa_id, usuario_id, cliente, tipo, apertura_en) VALUES (?, ?, ?, 'MESA', ?)"
        ).run(mesa_id, req.usuario.id, clienteLimpio, nowCO());
        cuentaId = cuenta.lastInsertRowid;
        await tx.prepare("UPDATE mesas SET estado = 'OCUPADA' WHERE id = ?").run(mesa_id);
        // Si al abrir se indicó un cliente, se refleja en el nombre de la mesa ("Mesa Juan")
        if (clienteLimpio) await tx.prepare('UPDATE mesas SET nombre_cliente = ? WHERE id = ?').run(clienteLimpio, mesa_id);
      }, { inmediata: true });
      logAuditoria(req, 'ABRIR_MESA', `Mesa ${mesa.numero}`);
      return res.json({ cuenta_id: cuentaId });
    }

    // Cuenta de mostrador (sin mesa)
    const cuenta = await db.prepare(
      "INSERT INTO cuentas_mesa (mesa_id, usuario_id, cliente, tipo, apertura_en) VALUES (NULL, ?, ?, 'MOSTRADOR', ?)"
    ).run(req.usuario.id, clienteLimpio, nowCO());
    logAuditoria(req, 'ABRIR_CUENTA', `Mostrador${clienteLimpio ? ` (${clienteLimpio})` : ''}`);
    res.json({ cuenta_id: cuenta.lastInsertRowid });
  } catch (err) {
    manejarError(res, err, 'Error al abrir la cuenta');
  }
});

// Ver una cuenta con sus items
router.get('/:id', async (req, res, next) => {
  try {
    const datos = await cuentaConItems(req.params.id);
    if (!datos) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(datos);
  } catch (err) {
    next(err);
  }
});

// Agregar producto a la cuenta (rebaja el stock de inmediato)
router.post('/:id/items', async (req, res, next) => {
  try {
    const { producto_id, cantidad } = req.body || {};
    if (!Number.isInteger(producto_id) || !Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    const cuenta = await db.prepare("SELECT * FROM cuentas_mesa WHERE id = ? AND estado = 'ABIERTA'").get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada o cerrada' });

    const producto = await db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(producto_id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    if (producto.stock_actual < cantidad) {
      return res.status(400).json({ error: `Stock insuficiente. Hay ${producto.stock_actual} ${producto.unidad_medida}` });
    }

    const subtotal = producto.precio_venta * cantidad;
    let item_id;
    await db.transaccion(async (tx) => {
      await descontarStock(tx, producto, cantidad, 'Venta en cuenta', req.usuario.id);
      const info = await tx.prepare(
        'INSERT INTO items_cuenta (cuenta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)'
      ).run(cuenta.id, producto_id, cantidad, producto.precio_venta, subtotal);
      item_id = info.lastInsertRowid;
    }, { inmediata: true });
    res.json({ ok: true, item_id, subtotal });
  } catch (err) {
    manejarError(res, err, 'Error al agregar el producto');
  }
});

// Quitar un producto de la cuenta (devuelve el stock)
router.delete('/:id/items/:itemId', async (req, res, next) => {
  try {
    const cuenta = await db.prepare("SELECT * FROM cuentas_mesa WHERE id = ? AND estado = 'ABIERTA'").get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada o cerrada' });

    const item = await db.prepare('SELECT * FROM items_cuenta WHERE id = ? AND cuenta_id = ?')
      .get(req.params.itemId, cuenta.id);
    if (!item) return res.status(404).json({ error: 'Producto no encontrado en la cuenta' });

    await db.transaccion(async (tx) => {
      await tx.prepare('DELETE FROM items_cuenta WHERE id = ?').run(item.id);
      await devolverStock(tx, item.producto_id, item.cantidad, 'Devolución de cuenta', req.usuario.id);
    }, { inmediata: true });
    res.json({ ok: true });
  } catch (err) {
    manejarError(res, err, 'Error al quitar el producto');
  }
});

// Ajustar la cantidad de un producto de la cuenta (botones +/-, escribir cantidad)
router.put('/:id/items/:itemId', async (req, res, next) => {
  try {
    const { cantidad } = req.body || {};
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
    const cuenta = await db.prepare("SELECT * FROM cuentas_mesa WHERE id = ? AND estado = 'ABIERTA'").get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada o cerrada' });

    const item = await db.prepare('SELECT * FROM items_cuenta WHERE id = ? AND cuenta_id = ?')
      .get(req.params.itemId, cuenta.id);
    if (!item) return res.status(404).json({ error: 'Producto no encontrado en la cuenta' });

    // Cantidad 0 = quitar el producto (igual que DELETE)
    if (cantidad === 0) {
      await db.transaccion(async (tx) => {
        await tx.prepare('DELETE FROM items_cuenta WHERE id = ?').run(item.id);
        await devolverStock(tx, item.producto_id, item.cantidad, 'Devolución de cuenta', req.usuario.id);
      }, { inmediata: true });
      return res.json({ ok: true, eliminado: true });
    }

    const delta = cantidad - item.cantidad;
    if (delta > 0) {
      const producto = await db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
      if (!producto || producto.stock_actual < delta) {
        return res.status(400).json({ error: `Stock insuficiente. Hay ${producto ? producto.stock_actual : 0}` });
      }
    }

    let subtotal;
    await db.transaccion(async (tx) => {
      if (delta > 0) {
        const producto = await tx.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
        await descontarStock(tx, producto, delta, 'Ajuste de cuenta', req.usuario.id);
      } else if (delta < 0) {
        await devolverStock(tx, item.producto_id, -delta, 'Ajuste de cuenta', req.usuario.id);
      }
      subtotal = item.precio_unitario * cantidad;
      await tx.prepare('UPDATE items_cuenta SET cantidad = ?, subtotal = ? WHERE id = ?').run(cantidad, subtotal, item.id);
    }, { inmediata: true });
    res.json({ ok: true, cantidad, subtotal });
  } catch (err) {
    manejarError(res, err, 'Error al actualizar el producto');
  }
});

// Editar una cuenta abierta: asignar/cambiar mesa y cliente (Fase E2)
router.put('/:id', async (req, res, next) => {
  try {
    const { mesa_id, cliente } = req.body || {};
    const cuenta = await db.prepare("SELECT * FROM cuentas_mesa WHERE id = ? AND estado = 'ABIERTA'").get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada o cerrada' });

    const nuevoMesaId = mesa_id === undefined
      ? cuenta.mesa_id
      : (mesa_id === null || mesa_id === '' ? null : Number(mesa_id));
    const clienteLimpio = cliente === undefined ? cuenta.cliente : (cliente?.trim() || null);

    if (nuevoMesaId != null) {
      const mesa = await db.prepare('SELECT * FROM mesas WHERE id = ?').get(nuevoMesaId);
      if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
      if (nuevoMesaId !== cuenta.mesa_id) {
        const abierta = await db.prepare(
          "SELECT id FROM cuentas_mesa WHERE mesa_id = ? AND estado = 'ABIERTA' AND id <> ?"
        ).get(nuevoMesaId, cuenta.id);
        if (abierta) return res.status(409).json({ error: 'La mesa ya tiene una cuenta abierta', cuenta_id: abierta.id });
      }
    }

    await db.transaccion(async (tx) => {
      if (nuevoMesaId !== cuenta.mesa_id) {
        // Al liberar la mesa anterior se limpia su nombre ("Mesa #" otra vez)
        if (cuenta.mesa_id) await tx.prepare("UPDATE mesas SET estado = 'LIBRE', nombre_cliente = NULL WHERE id = ?").run(cuenta.mesa_id);
        if (nuevoMesaId != null) await tx.prepare("UPDATE mesas SET estado = 'OCUPADA' WHERE id = ?").run(nuevoMesaId);
      }
      // El nombre de la mesa sigue al cliente de la cuenta (vacío = "Mesa #")
      if (nuevoMesaId != null) {
        await tx.prepare('UPDATE mesas SET nombre_cliente = ? WHERE id = ?').run(clienteLimpio, nuevoMesaId);
      }
      const tipo = nuevoMesaId != null ? 'MESA' : 'MOSTRADOR';
      await tx.prepare('UPDATE cuentas_mesa SET mesa_id = ?, tipo = ?, cliente = ? WHERE id = ?')
        .run(nuevoMesaId, tipo, clienteLimpio, cuenta.id);
    }, { inmediata: true });
    logAuditoria(req, 'EDITAR_CUENTA', `Cuenta #${cuenta.id} → ${nuevoMesaId ? `Mesa ${nuevoMesaId}` : 'Mostrador'}`);
    res.json({ ok: true, cuenta_id: cuenta.id });
  } catch (err) {
    manejarError(res, err, 'Error al editar la cuenta');
  }
});

// Cancelar una cuenta abierta sin cobrar (devuelve el stock y libera la mesa)
router.delete('/:id', async (req, res, next) => {
  try {
    const cuenta = await db.prepare("SELECT * FROM cuentas_mesa WHERE id = ? AND estado = 'ABIERTA'").get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada o ya cerrada' });
    const ventas = (await db.prepare('SELECT COUNT(*) AS c FROM ventas WHERE cuenta_id = ?').get(cuenta.id)).c;
    if (ventas > 0) return res.status(400).json({ error: 'La cuenta tiene ventas asociadas' });

    const items = await db.prepare('SELECT * FROM items_cuenta WHERE cuenta_id = ?').all(cuenta.id);
    await db.transaccion(async (tx) => {
      for (const it of items) await devolverStock(tx, it.producto_id, it.cantidad, 'Cancelación de cuenta', req.usuario.id);
      await tx.prepare('DELETE FROM items_cuenta WHERE cuenta_id = ?').run(cuenta.id);
      await tx.prepare('DELETE FROM cuentas_mesa WHERE id = ?').run(cuenta.id);
      if (cuenta.mesa_id) await tx.prepare("UPDATE mesas SET estado = 'LIBRE', nombre_cliente = NULL WHERE id = ?").run(cuenta.mesa_id);
    }, { inmediata: true });
    logAuditoria(req, 'CANCELAR_CUENTA', `Cuenta #${cuenta.id}`);
    res.json({ ok: true });
  } catch (err) {
    manejarError(res, err, 'Error al cancelar la cuenta');
  }
});

// Cobrar la cuenta (venta atómica). El stock ya se descontó al agregar los items.
router.post('/:id/cobrar', async (req, res, next) => {
  try {
    const { metodo_pago, pago_con, descuento, propina } = req.body || {};
    if (!METODOS_VALIDOS.includes(metodo_pago)) {
      return res.status(400).json({ error: 'Método de pago no válido' });
    }
    const desc = Number.isInteger(descuento) ? descuento : 0;
    const prop = Number.isInteger(propina) ? propina : 0;
    if (desc < 0) return res.status(400).json({ error: 'Descuento inválido' });
    if (prop < 0) return res.status(400).json({ error: 'Propina inválida' });

    const cuenta = await db.prepare("SELECT * FROM cuentas_mesa WHERE id = ? AND estado = 'ABIERTA'").get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada o ya cerrada' });

    const items = await db.prepare('SELECT * FROM items_cuenta WHERE cuenta_id = ?').all(cuenta.id);
    if (items.length === 0) return res.status(400).json({ error: 'La cuenta está vacía' });

    const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
    if (desc > subtotal) {
      return res.status(400).json({ error: 'El descuento no puede superar el subtotal' });
    }
    // El descuento baja lo que recibe el bar; la propina se cobra aparte (no es ingreso del bar)
    const total = subtotal - desc;

    let cambio = 0;
    if (metodo_pago === 'EFECTIVO') {
      const aPagar = total + prop;
      if (!Number.isInteger(pago_con) || pago_con < aPagar) {
        return res.status(400).json({ error: 'Monto recibido insuficiente' });
      }
      cambio = pago_con - aPagar;
    }

    let ventaId;
    await db.transaccion(async (tx) => {
      const venta = await tx.prepare(
        'INSERT INTO ventas (cuenta_id, usuario_id, total, metodo_pago, pago_con, cambio, descuento, propina, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(cuenta.id, req.usuario.id, total, metodo_pago, pago_con || null, cambio, desc, prop, nowCO());
      ventaId = venta.lastInsertRowid;

      await tx.prepare("UPDATE cuentas_mesa SET estado = 'CERRADA', cierre_en = ? WHERE id = ?").run(nowCO(), cuenta.id);
      if (cuenta.mesa_id) {
        await tx.prepare("UPDATE mesas SET estado = 'LIBRE', nombre_cliente = NULL WHERE id = ?").run(cuenta.mesa_id);
      }
    }, { inmediata: true });
    logAuditoria(req, 'VENTA', `Venta #${ventaId} - $${total} (${metodo_pago})${desc ? ` - descuento $${desc}` : ''}${prop ? ` - propina $${prop}` : ''}`);
    res.json({ venta_id: ventaId, subtotal, descuento: desc, propina: prop, total, cambio });
  } catch (err) {
    manejarError(res, err, 'Error al procesar el cobro');
  }
});

// Venta rápida: cobra de una vez, sin abrir cuenta manualmente (para compras de mostrador)
router.post('/rapida', async (req, res, next) => {
  try {
    const { items, metodo_pago, pago_con, descuento, propina, cliente } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Agrega al menos un producto' });
    }
    for (const it of items) {
      if (!Number.isInteger(it.producto_id) || !Number.isInteger(it.cantidad) || it.cantidad <= 0) {
        return res.status(400).json({ error: 'Datos de producto inválidos' });
      }
    }
    if (!METODOS_VALIDOS.includes(metodo_pago)) {
      return res.status(400).json({ error: 'Método de pago no válido' });
    }
    const desc = Number.isInteger(descuento) ? descuento : 0;
    const prop = Number.isInteger(propina) ? propina : 0;
    if (desc < 0 || prop < 0) return res.status(400).json({ error: 'Descuento o propina inválidos' });

    let resultado;
    await db.transaccion(async (tx) => {
      let subtotal = 0;
      const cuenta = await tx.prepare(
        "INSERT INTO cuentas_mesa (mesa_id, usuario_id, cliente, tipo, apertura_en) VALUES (NULL, ?, ?, 'MOSTRADOR', ?)"
      ).run(req.usuario.id, cliente?.trim() || null, nowCO());

      for (const it of items) {
        const producto = await tx.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(it.producto_id);
        if (!producto) throw errorNegocio(404, 'Producto no encontrado');
        if (producto.stock_actual < it.cantidad) {
          throw errorNegocio(400, `Stock insuficiente de ${producto.nombre}. Hay ${producto.stock_actual}`);
        }
        const sub = producto.precio_venta * it.cantidad;
        subtotal += sub;
        await descontarStock(tx, producto, it.cantidad, 'Venta rápida', req.usuario.id);
        await tx.prepare(
          'INSERT INTO items_cuenta (cuenta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)'
        ).run(cuenta.lastInsertRowid, it.producto_id, it.cantidad, producto.precio_venta, sub);
      }

      if (desc > subtotal) throw errorNegocio(400, 'El descuento no puede superar el subtotal');
      const total = subtotal - desc;

      let cambio = 0;
      if (metodo_pago === 'EFECTIVO') {
        const aPagar = total + prop;
        if (!Number.isInteger(pago_con) || pago_con < aPagar) {
          throw errorNegocio(400, 'Monto recibido insuficiente');
        }
        cambio = pago_con - aPagar;
      }

      const venta = await tx.prepare(
        'INSERT INTO ventas (cuenta_id, usuario_id, total, metodo_pago, pago_con, cambio, descuento, propina, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(cuenta.lastInsertRowid, req.usuario.id, total, metodo_pago, pago_con || null, cambio, desc, prop, nowCO());

      await tx.prepare("UPDATE cuentas_mesa SET estado = 'CERRADA', cierre_en = ? WHERE id = ?").run(nowCO(), cuenta.lastInsertRowid);
      resultado = { venta_id: venta.lastInsertRowid, subtotal, descuento: desc, propina: prop, total, cambio };
    }, { inmediata: true });

    logAuditoria(req, 'VENTA_RAPIDA', `Venta #${resultado.venta_id} - $${resultado.total} (${metodo_pago})`);
    res.json(resultado);
  } catch (err) {
    manejarError(res, err, 'Error al procesar la venta rápida');
  }
});

export default router;
