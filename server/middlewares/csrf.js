// Protección CSRF ligera: en métodos que cambian datos, si el navegador envía
// el header Origin, debe coincidir con el host del servidor. Los clientes que no
// son navegadores (tests, curl) no envían Origin y se permiten.
const METODOS_SEGUROS = ['GET', 'HEAD', 'OPTIONS'];

export function verificarOrigen(req, res, next) {
  if (METODOS_SEGUROS.includes(req.method)) return next();

  const origin = req.get('Origin');
  if (!origin) return next();

  let origenHost;
  try {
    origenHost = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Origen no permitido' });
  }

  if (origenHost === req.get('Host')) return next();
  return res.status(403).json({ error: 'Origen no permitido' });
}
