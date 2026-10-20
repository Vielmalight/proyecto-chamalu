import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';

const router = Router();

// Devuelve la fecha (YYYY-MM-DD) del día anterior a partir de una fecha dada
function diaAnterior(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Resumen de un día: ventas y, solo para el propietario, la ganancia
async function resumenDia(fecha, esPropietario) {
  const ventas = await db.prepare(
    "SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad FROM ventas WHERE estado = 'PAGADA' AND fecha LIKE ?"
  ).get(`${fecha}%`);

  const dia = { fecha, ventas: ventas.total, cantidad: ventas.cantidad };

  if (esPropietario) {
    // Ganancia = ventas netas − costo de lo vendido (precio_compra), sin ítems anulados
    const costo = (await db.prepare(`
      SELECT COALESCE(SUM(ic.cantidad * p.precio_compra), 0) AS costo
      FROM ventas v
      JOIN items_cuenta ic ON ic.cuenta_id = v.cuenta_id AND ic.anulado = 0
      JOIN productos p ON p.id = ic.producto_id
      WHERE v.estado = 'PAGADA' AND v.fecha LIKE ?
    `).get(`${fecha}%`)).costo;
    dia.ganancia = dia.ventas - costo;
  }

  return dia;
}

// Calcula el resumen del panel principal (Inicio).
// El cajero no recibe costos, ganancia, pérdida ni datos de caja.
export async function calcularResumen(usuario) {
  const esPropietario = usuario.rol === 'PROPIETARIO';
  const hoy = nowCO().slice(0, 10);
  const ayer = diaAnterior(hoy);

  const mesas = await db.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN estado = 'OCUPADA' THEN 1 ELSE 0 END), 0) AS ocupadas FROM mesas"
  ).get();

  const stockBajo = (await db.prepare(
    'SELECT COUNT(*) AS cantidad FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo'
  ).get()).cantidad;

  const alertas = await db.prepare(
    'SELECT id, tipo, mensaje, creado_en FROM alertas WHERE leida = 0 ORDER BY creado_en DESC LIMIT 5'
  ).all();

  // Cuentas abiertas (pendientes por cobrar) y su total vigente
  const pendientes = (await db.prepare(`
    SELECT COUNT(*) AS cantidad, COALESCE(SUM(sub), 0) AS total FROM (
      SELECT c.id, COALESCE(SUM(CASE WHEN ic.anulado = 0 THEN ic.subtotal ELSE 0 END), 0) AS sub
      FROM cuentas_mesa c
      LEFT JOIN items_cuenta ic ON ic.cuenta_id = c.id
      WHERE c.estado = 'ABIERTA'
      GROUP BY c.id
    )
  `).get());

  const resumen = {
    fecha: hoy,
    hoy: await resumenDia(hoy, esPropietario),
    ayer: await resumenDia(ayer, esPropietario),
    pendientes: { cantidad: pendientes.cantidad, total: pendientes.total },
    mesas_total: mesas.total,
    mesas_ocupadas: mesas.ocupadas,
    stock_bajo: stockBajo,
    alertas,
    turno_caja: null,
  };

  if (esPropietario) {
    // Pérdidas del día = gastos + descuadres de caja (faltantes o sobrantes, en valor absoluto)
    const gastos = (await db.prepare(
      'SELECT COALESCE(SUM(monto), 0) AS t FROM gastos WHERE fecha LIKE ?'
    ).get(`${hoy}%`)).t;
    const descuadre = (await db.prepare(
      "SELECT COALESCE(SUM(ABS(diferencia)), 0) AS t FROM turnos_caja WHERE estado = 'CERRADA' AND fecha_cierre LIKE ?"
    ).get(`${hoy}%`)).t;
    resumen.hoy.gastos = gastos;
    resumen.hoy.descuadre = descuadre;
    resumen.hoy.perdida = gastos + descuadre;

    const turno = await db.prepare(
      "SELECT * FROM turnos_caja WHERE estado = 'ABIERTA' ORDER BY id DESC LIMIT 1"
    ).get();
    if (turno) {
      const ventasTurno = (await db.prepare(
        "SELECT COALESCE(SUM(total), 0) AS total FROM ventas WHERE estado = 'PAGADA' AND fecha >= ?"
      ).get(turno.fecha_apertura)).total;
      const saldoChica = (await db.prepare(
        "SELECT COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto ELSE -monto END), 0) AS saldo FROM movimientos_caja_chica WHERE turno_id = ?"
      ).get(turno.id)).saldo;
      resumen.turno_caja = {
        monto_apertura: turno.monto_apertura,
        ventas_turno: ventasTurno,
        caja_chica_saldo: turno.monto_caja_chica + saldoChica,
        fecha_apertura: turno.fecha_apertura,
      };
    }
  }

  return resumen;
}

// Resumen para el panel principal (Inicio)
router.get('/resumen', async (req, res, next) => {
  try {
    res.json(await calcularResumen(req.usuario));
  } catch (err) {
    next(err);
  }
});

export default router;
