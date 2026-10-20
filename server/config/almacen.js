import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

// ---------------------------------------------------------------------------
// Almacén dual de imágenes (productos y logo):
//  - Local (desarrollo y pruebas): se guardan en public/uploads como siempre.
//  - Remoto (Vercel): disco efímero, así que se suben a Vercel Blob (acceso
//    público, CDN) y en la base de datos queda la URL completa de Blob.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

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

// Guarda una imagen (productos y logo) y devuelve su URL pública
export async function subirImagen(base64) {
  const { ext, buffer } = procesarBase64(base64);
  const nombre = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  if (db.modo === 'remoto') {
    const { put } = await import('@vercel/blob');
    const resultado = await put(`imagenes/${nombre}`, buffer, { access: 'public' });
    return resultado.url;
  }

  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), buffer);
  return `/uploads/${nombre}`;
}
