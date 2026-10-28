import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

/**
 * Ejecuta las migraciones pendientes
 * Solo usa CREATE TABLE IF NOT EXISTS, ALTER TABLE
 * Nunca DROP, DELETE sobre datos
 */
export function ejecutarMigraciones(db) {
  // Asegurar tabla de control
  const sqlControl = fs.readFileSync(path.join(MIGRATIONS_DIR, '000_migrations_aplicadas.sql'), 'utf8');
  db.exec(sqlControl);
  
  // Obtener migraciones ya aplicadas
  const aplicadas = new Set();
  try {
    const rows = db.prepare('SELECT nombre FROM migrations_aplicadas').all();
    for (const row of rows) {
      aplicadas.add(row.nombre);
    }
  } catch (e) {
    // Si falla, intentar crearla
  }
  
  // Leer archivos .sql ordenados
  const archivos = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f !== '000_migrations_aplicadas.sql')
    .sort();
  
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    
    const ruta = path.join(MIGRATIONS_DIR, archivo);
    const sql = fs.readFileSync(ruta, 'utf8');
    
    // Ejecutar migración
    try {
      db.exec(sql);
      db.prepare('INSERT INTO migrations_aplicadas (nombre) VALUES (?)').run(archivo);
      console.log(`[migraciones] Aplicada: ${archivo}`);
    } catch (e) {
      console.error(`[migraciones] ERROR al aplicar ${archivo}:`, e.message);
      throw e;
    }
  }
}
