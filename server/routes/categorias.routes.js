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
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    try {
      const info = await db.prepare('INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)')
        .run(nombre.trim(), descripcion?.trim() || '');
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
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const info = await db.prepare('UPDATE categorias SET nombre = ?, descripcion = ? WHERE id = ? AND activo = 1')
      .run(nombre.trim(), descripcion?.trim() || '', req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('PROPIETARIO'), async (req, res, next) => {
  try {
    // Soft delete: desactiva la categoría
    const info = await db.prepare('UPDATE categorias SET activo = 0 WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
