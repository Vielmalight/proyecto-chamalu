// Script simple para cargar inventario inicial desde productos.txt
// Se ejecuta una sola vez. No duplica productos si se corre de nuevo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TXT = path.join(ROOT, 'productos.txt');

function leerCSV() {
  const contenido = fs.readFileSync(TXT, 'utf8');
  const lineas = contenido.split(/\r?\n/);
  const filas = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    // Solo procesar líneas que empiecen con una categoría válida seguida de coma
    if (!l.includes(',')) continue;
    const primera = l.split(',')[0].trim();
    if (!['Gaseosas','Jugos','Aguas','Soda','Gatorade','Licores'].includes(primera)) continue;
    const partes = l.split(',');
    if (partes.length < 5) continue;
    const categoria = partes[0].trim();
    const producto = partes[1].trim();
    const presentacion = partes[2].trim();
    const stock = partes[3].trim();
    const precio = partes.slice(4).join(',').trim().replace(/\r/g,'');
    filas.push({ categoria, producto, presentacion, stock, precio });
  }
  return filas;
}

async function asegurarCategoria(nombre) {
  let cat = await db.prepare('SELECT id, nombre FROM categorias WHERE activo = 1 AND LOWER(TRIM(nombre)) = LOWER(?)').get(nombre);
  if (cat) return cat;
  try {
    const info = await db.prepare('INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)').run(nombre, '');
    return { id: info.lastInsertRowid, nombre };
  } catch {
    cat = await db.prepare('SELECT id, nombre FROM categorias WHERE activo = 1 AND LOWER(TRIM(nombre)) = LOWER(?)').get(nombre);
    return cat;
  }
}

async function main() {
  console.log('=== Carga de inventario inicial Chamalú Beer ===');
  const filas = leerCSV();
  console.log(`Filas leídas del CSV: ${filas.length}`);

  const categoriasReq = ['Gaseosas', 'Jugos', 'Aguas', 'Soda', 'Gatorade', 'Licores'];
  for (const c of categoriasReq) {
    await asegurarCategoria(c);
  }

  const mapaCat = {};
  const cats = await db.prepare('SELECT id, nombre FROM categorias WHERE activo = 1').all();
  for (const c of cats) mapaCat[c.nombre.toLowerCase()] = c.id;

  const pendientes = [];
  let insertados = 0;
  let omitidos = 0;

  for (const f of filas) {
    const catId = mapaCat[f.categoria.toLowerCase()];
    if (!catId) {
      console.log(`AVISO: Categoría no encontrada "${f.categoria}" para producto "${f.producto}". Se omite.`);
      omitidos++;
      continue;
    }

    const unidadMedida = f.presentacion;
    const stockNum = Number(f.stock) || 0;
    const precioVacio = f.precio === '' || f.precio === null || f.precio === undefined;
    const precioNum = precioVacio ? 0 : Number(f.precio);

    const dup = await db.prepare('SELECT id FROM productos WHERE activo = 1 AND LOWER(TRIM(nombre)) = LOWER(?) AND categoria_id = ? AND LOWER(TRIM(unidad_medida)) = LOWER(?)')
      .get(f.producto, catId, unidadMedida);
    if (dup) {
      console.log(`OMITIDO (ya existe): ${f.producto} / ${unidadMedida} [${f.categoria}]`);
      omitidos++;
      continue;
    }

    const esPendiente = precioVacio ? 1 : (precioNum <= 0 ? 1 : 0);
    const precioVenta = esPendiente ? 0 : precioNum;

    try {
      await db.prepare(
        `INSERT INTO productos (nombre, categoria_id, imagen_url, precio_compra, precio_venta, stock_actual, stock_minimo, unidad_medida, activo, precio_pendiente)
         VALUES (?, ?, NULL, 0, ?, ?, 0, ?, 1, ?)`
      ).run(f.producto, catId, precioVenta, stockNum, unidadMedida, esPendiente);

      console.log(`INSERTADO: ${f.producto} / ${unidadMedida} | stock=${stockNum} | precio=${esPendiente ? 'PENDIENTE' : precioVenta} | cat=${f.categoria}`);
      insertados++;
      if (esPendiente) {
        pendientes.push({ producto: f.producto, presentacion: unidadMedida, categoria: f.categoria, stock: stockNum });
      }
    } catch (err) {
      console.log(`ERROR al insertar ${f.producto}: ${err.message}`);
      omitidos++;
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Insertados: ${insertados}`);
  console.log(`Omitidos: ${omitidos}`);
  console.log(`\nProductos con PRECIO PENDIENTE (${pendientes.length}):`);
  if (pendientes.length === 0) {
    console.log('Ninguno');
  } else {
    for (const p of pendientes) {
      console.log(`- ${p.producto} / ${p.presentacion} [${p.categoria}] | stock: ${p.stock}`);
    }
    console.log('\nAVISO: Estos productos NO se pueden vender a $0. Asígnales precio desde Gestión.');
  }
  console.log('\nListo.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
