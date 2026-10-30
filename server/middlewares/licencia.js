import { db } from '../config/db.js';

// Interruptor de acceso del servicio.
// - El estado se guarda en la tabla `licencia` (una sola fila, id = 1).
// - Se cachea en memoria ~30 segundos para no consultar la base en cada petición.
// - Si la consulta falla, se deja pasar (fail-open): el bar no debe quedar
//   bloqueado por un error técnico.
const TTL_MS = 30 * 1000;

let cache = null; // { estado, mensaje, fecha_cambio, ts }

// Escapa texto para insertarlo en HTML (evita XSS)
export function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// Devuelve { estado, mensaje }. `forzar` ignora el caché (lo usa el panel).
export async function obtenerEstadoLicencia({ forzar = false } = {}) {
  if (!forzar && cache && Date.now() - cache.ts < TTL_MS) return cache;

  try {
    const fila = await db.prepare(
      'SELECT estado, mensaje, fecha_cambio FROM licencia WHERE id = 1'
    ).get();
    const estado = fila && fila.estado === 'suspendida' ? 'suspendida' : 'activa';
    cache = {
      estado,
      mensaje: fila?.mensaje || null,
      fecha_cambio: fila?.fecha_cambio || null,
      ts: Date.now(),
    };
    return cache;
  } catch (err) {
    // Fail-open: si la base falla, el servicio sigue funcionando
    console.error('[licencia] no se pudo consultar el estado, se permite el paso:', err.message);
    return { estado: 'activa', mensaje: null, ts: 0 };
  }
}

// Se llama al cambiar el estado desde el panel para que aplique de inmediato
export function invalidarCacheLicencia() {
  cache = null;
}

function esPanel(path) {
  return path === '/panel-dev' || path.startsWith('/panel-dev/');
}

// Recursos estáticos: se siguen sirviendo para que el panel y la pantalla de
// suspensión carguen sus estilos. No exponen datos del negocio.
function esEstatico(path) {
  return (
    path.startsWith('/uploads/') ||
    path.startsWith('/css/') ||
    path.startsWith('/js/') ||
    path.startsWith('/img/') ||
    path === '/manifest.json' ||
    path === '/sw.js' ||
    path === '/favicon.ico' ||
    /\.(css|js|mjs|png|jpe?g|webp|svg|gif|ico|woff2?|ttf|map)$/i.test(path)
  );
}

// Pantalla simple de servicio suspendido. Es autocontenida (sin archivos
// externos) y soporta modo claro/oscuro.
export function paginaSuspendida(mensaje) {
  const texto = escaparHtml(
    mensaje || 'El servicio está temporalmente suspendido. Vuelve pronto.'
  );
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Servicio suspendido</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #0f172a;
    color: #f1f5f9;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .caja {
    width: 100%;
    max-width: 520px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 40px 32px;
    text-align: center;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  }
  .icono {
    width: 52px;
    height: 52px;
    margin: 0 auto 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(245, 158, 11, 0.16);
    color: #f59e0b;
    font-size: 26px;
    font-weight: 700;
  }
  h1 { margin: 0 0 12px; font-size: 22px; }
  p { margin: 0; color: #94a3b8; line-height: 1.6; white-space: pre-line; }
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; }
    body { background: #f1f5f9; color: #0f172a; }
    .caja { background: #ffffff; border-color: #cbd5e1; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12); }
    p { color: #475569; }
  }
</style>
</head>
<body>
  <main class="caja">
    <div class="icono">!</div>
    <h1>Servicio suspendido</h1>
    <p>${texto}</p>
  </main>
</body>
</html>`;
}

// Se ejecuta antes de las rutas del bar y de la API. El panel del desarrollador
// y el cron de mantenimiento quedan exentos.
export async function verificarLicencia(req, res, next) {
  try {
    if (esPanel(req.path)) return next();
    if (req.path === '/api/cron/mantenimiento') return next();

    const licencia = await obtenerEstadoLicencia();
    if (licencia.estado !== 'suspendida') return next();

    if (req.path.startsWith('/api/')) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).json({ error: 'Servicio suspendido' });
    }

    if (esEstatico(req.path)) return next();

    res.set('Cache-Control', 'no-store');
    return res.status(503).type('html').send(paginaSuspendida(licencia.mensaje));
  } catch (err) {
    next(err);
  }
}
