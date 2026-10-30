import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

// ---------------------------------------------------------------------------
// Almacén dual de imágenes (productos y logo):
//  - Local (desarrollo y pruebas): se guardan en public/uploads como siempre.
//  - Remoto (Vercel): disco efímero, así que se suben a Vercel Blob. El
//    almacén es PRIVADO (comparte espacio con los respaldos, que contienen
//    datos sensibles), por eso no se puede usar la URL directa en un <img>:
//    la imagen se sirve con sesión desde GET /api/imagenes/:nombre.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

const PREFIJO_IMAGENES = 'imagenes/';
const RUTA_IMAGENES = '/api/imagenes/';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Valida una imagen en base64 y devuelve { ext, buffer }; lanza Error con mensaje en español
function procesarBase64(base64) {
  const match = base64.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) throw new Error('Formato de imagen no válido');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) throw new Error('Imagen demasiado grande (máx 2 MB)');
  return { ext, buffer };
}

// Nombre de archivo permitido (evita rutas y traversal)
export function nombreArchivoValido(nombre) {
  return typeof nombre === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nombre) && !nombre.includes('..');
}

// Convierte una URL antigua de Vercel Blob (pública o privada) a la ruta
// interna que entrega la imagen con sesión. Deja igual lo local (/uploads/…).
export function normalizarImagen(valor) {
  if (!valor || typeof valor !== 'string') return valor;
  if (valor.startsWith(RUTA_IMAGENES)) return valor;
  if (!/^https?:\/\//i.test(valor)) return valor;
  try {
    const { pathname } = new URL(valor);
    if (!pathname.startsWith(`/${PREFIJO_IMAGENES}`)) return valor;
    return RUTA_IMAGENES + pathname.slice(PREFIJO_IMAGENES.length + 1);
  } catch {
    return valor;
  }
}

// Guarda una imagen (productos y logo) y devuelve la ruta para mostrarla
export async function subirImagen(base64) {
  const { ext, buffer } = procesarBase64(base64);
  const nombre = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  if (db.modo === 'remoto') {
    const { put } = await import('@vercel/blob');
    const resultado = await put(`${PREFIJO_IMAGENES}${nombre}`, buffer, { access: 'private' });
    // Se guarda la ruta interna (no la URL privada, que no se puede abrir directo)
    const archivo = resultado.pathname.startsWith(PREFIJO_IMAGENES)
      ? resultado.pathname.slice(PREFIJO_IMAGENES.length)
      : nombre;
    return RUTA_IMAGENES + archivo;
  }

  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), buffer);
  return `/uploads/${nombre}`;
}
