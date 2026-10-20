import { Router } from 'express';
import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { filtro } = req.query;
    let sql = 'SELECT * FROM alertas';
    if (filtro === 'leidas') sql += ' WHERE leida = 1';
    else if (filtro === 'todas') sql += '';
    else sql += ' WHERE leida = 0';
    sql += ' ORDER BY creado_en DESC';
    res.json(await db.prepare(sql).all());
  } catch (err) {
    next(err);
  }
});

router.post('/:id/leer', async (req, res, next) => {
  try {
    await db.prepare('UPDATE alertas SET leida = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/no-leer', async (req, res, next) => {
  try {
    await db.prepare('UPDATE alertas SET leida = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Generar alertas automáticas (se llama internamente, puede ser async)
export async function generarAlertas() {
  // Stock bajo
  const productosBajoStock = await db.prepare(
    'SELECT * FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo'
  ).all();
  for (const p of productosBajoStock) {
    const existe = await db.prepare("SELECT id FROM alertas WHERE tipo = 'STOCK_BAJO' AND mensaje LIKE ? AND leida = 0").get(`%${p.nombre}%`);
    if (!existe) {
      await db.prepare('INSERT INTO alertas (tipo, mensaje, creado_en) VALUES (?, ?, ?)')
        .run('STOCK_BAJO', `Stock bajo: ${p.nombre} (${p.stock_actual} ${p.unidad_medida} restantes)`, nowCO());
    }
  }

  // Caja chica baja
  const turno = await db.prepare("SELECT * FROM turnos_caja WHERE estado = 'ABIERTA' ORDER BY id DESC LIMIT 1").get();
  if (turno) {
    const saldo = await db.prepare("SELECT COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto ELSE -monto END), 0) AS s FROM movimientos_caja_chica WHERE turno_id = ?").get(turno.id).s;
    const total = turno.monto_caja_chica + saldo;
    const limite = parseInt((await db.prepare("SELECT valor FROM configuracion WHERE clave = 'limite_caja_chica'").get())?.valor || '50000', 10);
    if (total < limite) {
      const existe = await db.prepare("SELECT id FROM alertas WHERE tipo = 'CAJA_CHICA_BAJA' AND leida = 0").get();
      if (!existe) {
        await db.prepare('INSERT INTO alertas (tipo, mensaje, creado_en) VALUES (?, ?, ?)')
          .run('CAJA_CHICA_BAJA', `Caja chica baja: $${total} (límite: $${limite})`, nowCO());
      }
    }
  }
}

export default router;
