import { Router } from 'express';
import { Readable } from 'node:stream';
import { db } from '../config/db.js';
import { nombreArchivoValido } from '../config/almacen.js';

const router = Router();

const TIPOS = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

// Entrega una imagen guardada en Vercel Blob privado.
// Va montada bajo /api, así que ya pasa por requireAuth (solo con sesión).
router.get('/:nombre', async (req, res, next) => {
  try {
    const { nombre } = req.params;
    if (!nombreArchivoValido(nombre)) {
      return res.status(400).json({ error: 'Nombre inválido' });
    }
    const ext = nombre.split('.').pop().toLowerCase();
    if (!TIPOS[ext]) return res.status(400).json({ error: 'Tipo de imagen no permitido' });

    // En local las imágenes son estáticas (/uploads/…) y no llegan aquí
    if (db.modo !== 'remoto') return res.status(404).json({ error: 'Imagen no encontrada' });

    const { get } = await import('@vercel/blob');
    const resultado = await get(`imagenes/${nombre}`, { access: 'private' });
    if (!resultado || resultado.statusCode !== 200 || !resultado.stream) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    res.setHeader('Content-Type', resultado.blob?.contentType || TIPOS[ext]);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    Readable.fromWeb(resultado.stream).pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
