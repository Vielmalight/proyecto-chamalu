import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'data/chamalu.db');
const db = new DatabaseSync(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('TABLAS:', tables.map(t => t.name).join(', '));

const c = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='categorias'").get();
console.log('\nCATEGORIAS:\n' + (c?.sql || 'NO EXISTE'));

const p = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='productos'").get();
console.log('\nPRODUCTOS:\n' + (p?.sql || 'NO EXISTE'));

console.log('\nCONTEO:');
console.log('categorias:', db.prepare('SELECT COUNT(*) as c FROM categorias').get().c);
console.log('productos:', db.prepare('SELECT COUNT(*) as c FROM productos').get().c);

db.close();
