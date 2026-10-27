import { Router } from 'express';
import { db } from '../config/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

const router = Router();

// Listar categorías: cualquier usuario autenticado (el cajero las necesita para filtrar).
// Crear, editar o eliminar: solo el propietario.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await db.prepare('SELECT * FROM categorias WHERE activo = 1 ORDER BY nombre').all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nombre, descripcion } = req.body || {};
    const nombreLimpio = nombre?.trim();
    if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es obligatorio' });

    // Evitar duplicados sin distinguir mayúsculas/minúsculas
    const existente = await db.prepare('SELECT id FROM categorias WHERE activo = 1 AND LOWER(TRIM(nombre)) = LOWER(?)').get(nombreLimpio);
    if (existente) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });

    try {
      const info = await db.prepare('INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)')
        .run(nombreLimpio, descripcion?.trim() || '');
      res.json({ id: info.lastInsertRowid });
    } catch {
      res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    const { nombre, descripcion } = req.body || {};
    const nombreLimpio = nombre?.trim();
    if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es obligatorio' });

    // Evitar duplicados sin distinguir mayúsculas/minúsculas (excluyendo el propio id)
    const duplicado = await db.prepare('SELECT id FROM categorias WHERE activo = 1 AND LOWER(TRIM(nombre)) = LOWER(?) AND id != ?').get(nombreLimpio, req.params.id);
    if (duplicado) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });

    const info = await db.prepare('UPDATE categorias SET nombre = ?, descripcion = ? WHERE id = ? AND activo = 1')
      .run(nombreLimpio, descripcion?.trim() || '', req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    // No permitir eliminar si tiene productos activos
    const conteo = await db.prepare('SELECT COUNT(*) AS c FROM productos WHERE categoria_id = ? AND activo = 1').get(req.params.id);
    if (conteo?.c > 0) {
      return res.status(409).json({ error: `No se puede eliminar esta categoría porque tiene ${conteo.c} producto(s) activos. Debes mover o reasignar esos productos primero.` });
    }

    // Soft delete: desactiva la categoría
    const info = await db.prepare('UPDATE categorias SET activo = 0 WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
