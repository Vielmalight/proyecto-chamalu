import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initSchema, seedAdmin, limpiarSesiones } from './config/db.js';
import { requireAuth, bloquearSiDebeCambiarPassword } from './middlewares/auth.js';
import { verificarOrigen } from './middlewares/csrf.js';
import authRoutes from './routes/auth.routes.js';
import cajaRoutes from './routes/caja.routes.js';
import categoriasRoutes from './routes/categorias.routes.js';
import productosRoutes from './routes/productos.routes.js';
import mesasRoutes from './routes/mesas.routes.js';
import cuentasRoutes from './routes/cuentas.routes.js';
import ventasRoutes from './routes/ventas.routes.js';
import inventarioRoutes from './routes/inventario.routes.js';
import gastosRoutes from './routes/gastos.routes.js';
import alertasRoutes, { generarAlertas } from './routes/alertas.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import configuracionRoutes from './routes/configuracion.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import reportesRoutes from './routes/reportes.routes.js';
import inversionesRoutes from './routes/inversiones.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Cargar .env si existe (Node 20.6+ lo trae integrado)
try {
  process.loadEnvFile();
} catch {
  // no hay .env, seguimos con las variables del entorno
}

// Si no hay SESSION_SECRET, generamos uno y lo guardamos en .env
if (!process.env.SESSION_SECRET) {
  const secret = crypto.randomBytes(32).toString('hex');
  process.env.SESSION_SECRET = secret;
  const envPath = path.join(__dirname, '..', '.env');
  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    content = '';
  }
  if (!content.includes('SESSION_SECRET=')) {
    // En Vercel el sistema de archivos es de solo lectura: si no se puede
    // guardar, usamos el secreto generado solo para esta sesión
    try {
      fs.appendFileSync(envPath, `\nSESSION_SECRET=${secret}\n`);
      console.warn('SESSION_SECRET no estaba definido: se generó uno nuevo y se guardó en .env');
    } catch {
      console.warn('SESSION_SECRET no estaba definido: se generó uno nuevo (no se pudo guardar en .env)');
    }
  }
}

await initSchema();
await seedAdmin();

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Permite los manejadores en línea (onclick/onchange) que usa el frontend
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // 'https:' permite las imágenes de Vercel Blob (dominio distinto en producción)
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  })
);
// Límite de 5 MB: las imágenes de producto en base64 superan el 100 KB por defecto
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(verificarOrigen);

app.use('/api/auth', authRoutes);

// Mantenimiento programado (Vercel Cron, 1 vez al día en plan Hobby):
// genera alertas y limpia sesiones expiradas. Se monta antes del control de
// sesión y se valida con el header que envía Vercel (CRON_SECRET).
app.get('/api/cron/mantenimiento', async (req, res) => {
  const secreto = process.env.CRON_SECRET;
  const autorizacion = req.get('Authorization') || '';
  if (!secreto || autorizacion !== `Bearer ${secreto}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    await generarAlertas();
    await limpiarSesiones();
    res.json({ ok: true });
  } catch (err) {
    console.error('cron mantenimiento:', err);
    res.status(500).json({ error: 'Error en el mantenimiento' });
  }
});

// Todo lo demás bajo /api requiere sesión activa
app.use('/api', requireAuth);
// El admin inicial debe cambiar su contraseña antes de usar el resto del sistema
app.use('/api', bloquearSiDebeCambiarPassword);

app.use('/api/caja', cajaRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/mesas', mesasRoutes);
app.use('/api/cuentas', cuentasRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/gastos', gastosRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/configuracion', configuracionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/inversiones', inversionesRoutes);

// Al arrancar: generar alertas y limpiar sesiones (también corre en cada
// arranque en frío de Vercel)
generarAlertas().catch((err) => console.error('alertas:', err));
limpiarSesiones().catch((err) => console.error('limpiar sesiones:', err));

// Tareas periódicas: solo en local (en Vercel los intervalos no sirven porque
// el proceso es efímero; allí las ejecuta el cron /api/cron/mantenimiento)
if (!process.env.VERCEL) {
  setInterval(() => generarAlertas().catch((err) => console.error('alertas:', err)), 60000);
  setInterval(() => limpiarSesiones().catch((err) => console.error('limpiar sesiones:', err)), 30 * 60 * 1000);
}

// 404 para rutas de API desconocidas
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// En Vercel la app se exporta como función serverless (ver server.js) y no
// abre puerto; en local la arrancamos normalmente
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  Chamalú Beer corriendo en http://localhost:${PORT}`);
    console.log('  Usuario inicial: admin / admin123\n');
  });
}

export default app;
