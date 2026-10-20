import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { db } from '../config/db.js';
import { subirImagen } from '../config/almacen.js';
import { nowCO } from '../config/constants.js';
import { requireRole } from '../middlewares/roles.js';
import { logAuditoria } from '../middlewares/auditoria.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Permite usar otra carpeta de copias (por ejemplo, en las pruebas automáticas)
const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(__dirname, '..', '..', 'data', 'backups');
const MAX_BACKUPS = 10;
const esRemoto = db.modo === 'remoto';

// Copias de seguridad duales:
//  - Local: VACUUM INTO a data/backups/*.db (archivo SQLite real).
//  - Remoto: volcado JSON de todas las tablas a Vercel Blob con acceso PRIVADO
//    (contiene hashes de contraseñas y datos de clientes: jamás público).
// Formato según modo: chamalu-<fecha>.db (local) | chamalu-<fecha>.json (remoto).
const NOMBRE_LOCAL = /^chamalu-[\d]+\.db$/;
const NOMBRE_REMOTO = /^chamalu-[\d]+\.json$/;

if (!esRemoto && !fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const router = Router();

// SDK de Blob solo se carga en modo remoto (en local no hace falta el token)
async function blobSdk() {
  return import('@vercel/blob');
}

// ---------------- Copias de seguridad (solo propietario) ----------------

// Lista las copias existentes, la más reciente primero
router.get('/backups', requireRole('PROPIETARIO'), async (req, res) => {
  try {
    if (esRemoto) {
      const { list } = await blobSdk();
      const { blobs } = await list({ prefix: 'backups/' });
      const copias = blobs
        .map((b) => ({ nombre: b.pathname.split('/').pop(), tamano: b.size, fecha: b.uploadedAt.toISOString() }))
        .filter((c) => NOMBRE_REMOTO.test(c.nombre))
        .sort((a, b) => (a.nombre < b.nombre ? 1 : -1));
      return res.json(copias);
    }
    const copias = fs.readdirSync(BACKUPS_DIR)
      .filter((n) => n.endsWith('.db'))
      .map((n) => {
        const info = fs.statSync(path.join(BACKUPS_DIR, n));
        return { nombre: n, tamano: info.size, fecha: info.mtime.toISOString() };
      })
      .sort((a, b) => (a.nombre < b.nombre ? 1 : -1));
    res.json(copias);
  } catch (err) {
    console.error('Error al listar copias de seguridad', err);
    res.status(500).json({ error: 'No se pudieron listar las copias de seguridad' });
  }
});

// Crea una copia (local: VACUUM INTO · remoto: volcado JSON privado en Blob)
router.post('/backups', requireRole('PROPIETARIO'), async (req, res) => {
  try {
    if (esRemoto) {
      const nombre = `chamalu-${nowCO().replace(/[-: ]/g, '')}.json`;
      const tablas = (await db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all()).map((t) => t.name);
      const datos = {};
      for (const t of tablas) {
        datos[t] = await db.prepare(`SELECT * FROM "${t}"`).all();
      }
      const json = JSON.stringify({ base: 'chamalu', creado_en: nowCO(), tablas: datos });
      const { put } = await blobSdk();
      await put(`backups/${nombre}`, json, { access: 'private', addRandomSuffix: false });
      await limpiarBackupsRemotos();
      logAuditoria(req, 'BACKUP', `Copia creada: ${nombre}`);
      return res.json({ ok: true, nombre });
    }

    const nombre = `chamalu-${nowCO().replace(/[-: ]/g, '')}.db`;
    const destino = path.join(BACKUPS_DIR, nombre);
    await db.exec(`VACUUM INTO '${destino.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    limpiarBackupsAntiguos();
    logAuditoria(req, 'BACKUP', `Copia creada: ${nombre}`);
    res.json({ ok: true, nombre });
  } catch {
    res.status(500).json({ error: 'No se pudo crear la copia de seguridad' });
  }
});

// Descarga una copia existente
router.get('/backups/:nombre', requireRole('PROPIETARIO'), async (req, res) => {
  try {
    const { nombre } = req.params;
    const patron = esRemoto ? NOMBRE_REMOTO : NOMBRE_LOCAL;
    if (!patron.test(nombre)) return res.status(400).json({ error: 'Nombre inválido' });

    if (esRemoto) {
      const { get } = await blobSdk();
      const { stream } = await get(`backups/${nombre}`, { access: 'private' });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
      Readable.fromWeb(stream).pipe(res);
      return;
    }

    const ruta = path.join(BACKUPS_DIR, nombre);
    if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'Copia no encontrada' });
    res.download(ruta, nombre);
  } catch {
    res.status(404).json({ error: 'Copia no encontrada' });
  }
});

function limpiarBackupsAntiguos() {
  const copias = fs.readdirSync(BACKUPS_DIR)
    .filter((n) => n.endsWith('.db'))
    .sort();
  const sobrantes = copias.length - MAX_BACKUPS;
  for (let i = 0; i < sobrantes; i++) {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, copias[i])); } catch { /* ignorar */ }
  }
}

// Conserva las últimas MAX_BACKUPS copias remotas (los nombres ordenan por fecha)
async function limpiarBackupsRemotos() {
  const { list, del } = await blobSdk();
  const { blobs } = await list({ prefix: 'backups/' });
  const nombres = blobs
    .map((b) => b.pathname)
    .filter((p) => NOMBRE_REMOTO.test(p.split('/').pop()))
    .sort();
  const sobrantes = nombres.length - MAX_BACKUPS;
  if (sobrantes > 0) await del(nombres.slice(0, sobrantes));
}


router.get('/', async (req, res, next) => {
  try {
    const rows = await db.prepare('SELECT * FROM configuracion').all();
    const config = {};
    rows.forEach((r) => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (err) {
    next(err);
  }
});

router.put('/', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nombre_negocio, limite_caja_chica, stock_minimo_defecto, metodos_pago } = req.body || {};
    const updates = [];
    if (nombre_negocio !== undefined) updates.push(['nombre_negocio', nombre_negocio]);
    if (limite_caja_chica !== undefined) updates.push(['limite_caja_chica', String(limite_caja_chica)]);
    if (stock_minimo_defecto !== undefined) updates.push(['stock_minimo_defecto', String(stock_minimo_defecto)]);
    if (metodos_pago !== undefined) updates.push(['metodos_pago', JSON.stringify(metodos_pago)]);

    const upsert = db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
    for (const [clave, valor] of updates) {
      await upsert.run(clave, valor);
    }
    logAuditoria(req, 'CONFIGURACION', 'Actualización de configuración');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logo', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { imagen_base64 } = req.body || {};
    if (!imagen_base64) return res.status(400).json({ error: 'No se recibió imagen' });
    let url;
    try {
      url = await subirImagen(imagen_base64);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    await db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
      .run('logo', url);
    logAuditoria(req, 'LOGO', 'Logo actualizado');
    res.json({ ok: true, url });
  } catch (err) {
    next(err);
  }
});

export default router;
