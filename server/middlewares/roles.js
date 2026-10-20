// Verifica que el usuario tenga un rol específico. Debe ir DESPUÉS de requireAuth.
export function requireRole(rol) {
  return (req, res, next) => {
    if (!req.usuario || req.usuario.rol !== rol) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}
