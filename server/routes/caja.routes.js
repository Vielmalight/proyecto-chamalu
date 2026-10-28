import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const router = Router();

// Todas las rutas de caja requieren sesión (propietario y cajero abren caja al entrar)
router.use(requireAuth);

// Devuelve el turno abierto actual, si existe
async function turnoAbierto() {
  return db.prepare("SELECT * FROM turnos_caja WHERE estado = 'ABIERTA' ORDER BY id DESC LIMIT 1").get();
}

// ------------- Apertura de caja (se pide al iniciar sesión) -------------
router.post('/apertura', async (req, res, next) => {
  try {
    const { monto_apertura, monto_caja_chica } = req.body || {};
    if (!Number.isInteger(monto_apertura) || monto_apertura < 0) {
      return res.status(400).json({ error: 'Monto de apertura inválido' });
    }
    if (!Number.isInteger(monto_caja_chica) || monto_caja_chica < 0) {
      return res.status(400).json({ error: 'Monto de caja chica inválido' });
    }

    if (await turnoAbierto()) {
      return res.status(409).json({ error: 'Ya hay un turno de caja abierto' });
    }

    const info = await db.prepare(
      'INSERT INTO turnos_caja (usuario_id, monto_apertura, monto_caja_chica, fecha_apertura) VALUES (?, ?, ?, ?)'
    ).run(req.usuario.id, monto_apertura, monto_caja_chica, nowCO());

    logAuditoria(req, 'CAJA_APERTURA', `Turno #${info.lastInsertRowid} - Mayor: $${monto_apertura}, Chica: $${monto_caja_chica}`);
    const turno = await db.prepare('SELECT * FROM turnos_caja WHERE id = ?').get(info.lastInsertRowid);
    res.json({ ok: true, turno });
  } catch (err) {
    next(err);
  }
});

// ------------- Editar montos de apertura del turno abierto (solo propietario) -------------
router.put('/apertura', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { monto_apertura, monto_caja_chica } = req.body || {};
    if (!Number.isInteger(monto_apertura) || monto_apertura < 0) {
      return res.status(400).json({ error: 'Monto de apertura inválido' });
    }
    if (!Number.isInteger(monto_caja_chica) || monto_caja_chica < 0) {
      return res.status(400).json({ error: 'Monto de caja chica inválido' });
    }

    const turno = await turnoAbierto();
    if (!turno) return res.status(404).json({ error: 'No hay un turno de caja abierto' });

    // El monto de caja chica no debe dejar el saldo en negativo
    const saldoChica = (await db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto ELSE -monto END), 0) AS saldo FROM movimientos_caja_chica WHERE turno_id = ?"
    ).get(turno.id)).saldo;
    if (monto_caja_chica + saldoChica < 0) {
      return res.status(400).json({ error: 'El monto de caja chica dejaría un saldo negativo' });
    }

    await db.prepare('UPDATE turnos_caja SET monto_apertura = ?, monto_caja_chica = ? WHERE id = ?')
      .run(monto_apertura, monto_caja_chica, turno.id);

    logAuditoria(
      req,
      'CAJA_APERTURA_EDITADA',
      `Turno #${turno.id} - Antes: mayor $${turno.monto_apertura}, chica $${turno.monto_caja_chica} / Ahora: mayor $${monto_apertura}, chica $${monto_caja_chica}`
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------- Estado / resumen del turno abierto -------------
router.get('/estado', async (req, res, next) => {
  try {
    const turno = await turnoAbierto();
    res.json({ turno: turno || null });
  } catch (err) {
    next(err);
  }
});

router.get('/resumen', async (req, res, next) => {
  try {
    const turno = await turnoAbierto();
    if (!turno) return res.json({ turno: null });

    const porMetodo = await db.prepare(
      `SELECT p.metodo_pago, COALESCE(SUM(p.monto), 0) AS total, COUNT(DISTINCT p.venta_id) AS cantidad 
       FROM pagos_venta p 
       JOIN ventas v ON v.id = p.venta_id 
       WHERE v.estado = 'PAGADA' AND v.fecha >= ? 
       GROUP BY p.metodo_pago`
    ).all(turno.fecha_apertura);

    const ventas_total = (await db.prepare(
      "SELECT COALESCE(SUM(total), 0) AS total FROM ventas WHERE estado = 'PAGADA' AND fecha >= ?"
    ).get(turno.fecha_apertura)).total;
    const ventas_cantidad = (await db.prepare(
      "SELECT COUNT(*) AS cantidad FROM ventas WHERE estado = 'PAGADA' AND fecha >= ?"
    ).get(turno.fecha_apertura)).cantidad;
    let ventas_efectivo = (await db.prepare(
      `SELECT COALESCE(SUM(p.monto), 0) AS total 
       FROM pagos_venta p 
       JOIN ventas v ON v.id = p.venta_id 
       WHERE v.estado = 'PAGADA' AND p.metodo_pago = 'EFECTIVO' AND v.fecha >= ?`
    ).get(turno.fecha_apertura)).total;
    if (ventas_efectivo > ventas_total) ventas_efectivo = ventas_total;
    const propinas = (await db.prepare(
      "SELECT COALESCE(SUM(propina), 0) AS t FROM ventas WHERE estado = 'PAGADA' AND fecha >= ?"
    ).get(turno.fecha_apertura)).t;

    const cajaChica = (await db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto ELSE -monto END), 0) AS saldo FROM movimientos_caja_chica WHERE turno_id = ?"
    ).get(turno.id)).saldo;
    const chicaSalidas = (await db.prepare(
      "SELECT COALESCE(SUM(monto), 0) AS t FROM movimientos_caja_chica WHERE turno_id = ? AND tipo = 'SALIDA'"
    ).get(turno.id)).t;
    const chicaEntradas = (await db.prepare(
      "SELECT COALESCE(SUM(monto), 0) AS t FROM movimientos_caja_chica WHERE turno_id = ? AND tipo = 'ENTRADA'"
    ).get(turno.id)).t;

    res.json({
      turno,
      ventas_total,
      ventas_efectivo,
      ventas_cantidad,
      propinas,
      por_metodo: porMetodo,
      efectivo_esperado: turno.monto_apertura + ventas_efectivo - chicaSalidas + chicaEntradas,
      caja_chica_saldo: turno.monto_caja_chica + cajaChica,
    });
  } catch (err) {
    next(err);
  }
});

// ------------- Cierre de caja -------------
router.post('/cierre', async (req, res, next) => {
  try {
    const { monto_declarado } = req.body || {};
    if (!Number.isInteger(monto_declarado) || monto_declarado < 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    const turno = await turnoAbierto();
    if (!turno) return res.status(404).json({ error: 'No hay un turno de caja abierto' });

    // Solo el efectivo entra a la caja física del bar (el resto va por datáfono/transferencia)
    const ventasTotal = (await db.prepare(
      "SELECT COALESCE(SUM(total), 0) AS total FROM ventas WHERE estado = 'PAGADA' AND fecha >= ?"
    ).get(turno.fecha_apertura)).total;
    let ventasEfectivo = (await db.prepare(
      `SELECT COALESCE(SUM(p.monto), 0) AS total 
       FROM pagos_venta p 
       JOIN ventas v ON v.id = p.venta_id 
       WHERE v.estado = 'PAGADA' AND p.metodo_pago = 'EFECTIVO' AND v.fecha >= ?`
    ).get(turno.fecha_apertura)).total;
    if (ventasEfectivo > ventasTotal) ventasEfectivo = ventasTotal;
    const propinas = (await db.prepare(
      "SELECT COALESCE(SUM(propina), 0) AS total FROM ventas WHERE estado = 'PAGADA' AND fecha >= ?"
    ).get(turno.fecha_apertura)).total;
    const cajaChicaSalidas = (await db.prepare(
      "SELECT COALESCE(SUM(monto), 0) AS total FROM movimientos_caja_chica WHERE turno_id = ? AND tipo = 'SALIDA'"
    ).get(turno.id)).total;
    const cajaChicaEntradas = (await db.prepare(
      "SELECT COALESCE(SUM(monto), 0) AS total FROM movimientos_caja_chica WHERE turno_id = ? AND tipo = 'ENTRADA'"
    ).get(turno.id)).total;

    const montoEsperado = turno.monto_apertura + ventasEfectivo - cajaChicaSalidas + cajaChicaEntradas;
    const diferencia = monto_declarado - montoEsperado;

    // Cierre atómico: el turno se cierra completo o no se cierra
    await db.transaccion(async (tx) => {
      await tx.prepare(
        "UPDATE turnos_caja SET estado = 'CERRADA', fecha_cierre = ?, monto_cierre_declarado = ?, diferencia = ? WHERE id = ?"
      ).run(nowCO(), monto_declarado, diferencia, turno.id);
    });
    logAuditoria(req, 'CAJA_CIERRE', `Turno #${turno.id} - Declarado: $${monto_declarado}, Diferencia: $${diferencia}`);
    res.json({
      ok: true,
      monto_esperado: montoEsperado,
      diferencia,
      ventas_total: ventasTotal,
      ventas_efectivo: ventasEfectivo,
      propinas,
    });
  } catch (err) {
    next(err);
  }
});

// ------------- Historial de turnos cerrados (solo propietario) -------------
router.get('/turnos', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const turnos = await db.prepare(`
      SELECT t.*, u.nombre AS usuario_nombre, u.apodo AS usuario_apodo
      FROM turnos_caja t
      LEFT JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.estado = 'CERRADA'
      ORDER BY t.fecha_cierre DESC, t.id DESC
      LIMIT 50
    `).all();
    res.json(turnos);
  } catch (err) {
    next(err);
  }
});

// ------------- Caja chica: movimientos del turno abierto -------------
router.get('/chica', async (req, res, next) => {
  try {
    const turno = await turnoAbierto();
    if (!turno) return res.json({ turno: null, movimientos: [] });
    const movimientos = await db.prepare(
      'SELECT * FROM movimientos_caja_chica WHERE turno_id = ? ORDER BY fecha DESC, id DESC'
    ).all(turno.id);
    res.json({ turno, movimientos });
  } catch (err) {
    next(err);
  }
});

router.post('/chica', async (req, res, next) => {
  try {
    const { tipo, monto, descripcion } = req.body || {};
    if (tipo !== 'ENTRADA' && tipo !== 'SALIDA') {
      return res.status(400).json({ error: 'Tipo inválido' });
    }
    if (!Number.isInteger(monto) || monto <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }
    if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción obligatoria' });

    const turno = await turnoAbierto();
    if (!turno) return res.status(404).json({ error: 'No hay un turno de caja abierto' });

    // No permitir que la caja chica quede negativa
    if (tipo === 'SALIDA') {
      const saldo = (await db.prepare(
        "SELECT COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto ELSE -monto END), 0) AS saldo FROM movimientos_caja_chica WHERE turno_id = ?"
      ).get(turno.id)).saldo;
      const disponible = turno.monto_caja_chica + saldo;
      if (monto > disponible) {
        return res.status(400).json({ error: `Saldo insuficiente en caja chica (disponible: $${disponible})` });
      }
    }

    const info = await db.prepare(
      'INSERT INTO movimientos_caja_chica (turno_id, tipo, monto, descripcion, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(turno.id, tipo, monto, descripcion.trim(), req.usuario.id, nowCO());

    logAuditoria(req, 'CAJA_CHICA_' + tipo, `${descripcion.trim()} - $${monto}`);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

export default router;
