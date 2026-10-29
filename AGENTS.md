# AGENTS.md — Chamalú Beer

## Reglas de trabajo (obligatorias)
1. Lee `MEMORY.md` al iniciar para saber la fase actual y las decisiones tomadas.
2. Primero se planifica; no escribas código hasta que yo diga "aprobado".
3. No modifiques, crees ni borres nada sin mostrarme antes qué vas a hacer.
4. Trabaja una sola fase a la vez; no pases a otra por tu cuenta.
5. No agregues librerías, servicios ni archivos complejos sin preguntarme.
6. Si hay varias opciones, dame 2 o 3 con ventajas y desventajas y espera mi decisión.
7. Antes de entregar código, revísalo buscando errores; al terminar la fase dame una lista de pruebas.
8. Al terminar cada fase, propón qué actualizar en `MEMORY.md` y la sección Estructura de este archivo, y espera mi aprobación.
9. Responde en español, claro y sin tecnicismos innecesarios.
10. El flujo de decisiones vive en `decisiones.txt`: yo escribo las preguntas (A, B, C…), tú respondes bajo `R:` y solo tú decides. No implemento hasta leer tu respuesta.


## Seguridad (obligatoria)
- Validar y limpiar todos los datos de entrada (SQL y XSS).
- Límite de intentos de login y expiración de sesión por inactividad.
- Cambio de contraseña pidiendo la actual.
- Nunca desplegar con credenciales por defecto; el admin inicial debe cambiar su contraseña en el primer login.
- Registrar acciones importantes (login, cambios de precio, borrados).
- CSRF: se valida el header `Origin` y se exige `X-CSRF-Token` (derivado de la sesión) en POST/PUT/DELETE. El frontend lo envía solo; cualquier cliente nuevo debe incluirlo.
- Nunca subir a GitHub .env, data/*.db ni la carpeta uploads (deben estar en .gitignore).
- El proyecto de Vercel tiene Git conectado: **un push a `main` despliega a producción**. Para probar sin publicar, usar una rama aparte.

## Datos
- Operaciones críticas atómicas (cerrar cuenta, mover stock, cerrar caja).
- Nunca permitir stock ni precios negativos.
- No borres productos con historial de ventas: desactívalos.
- No modifiques ni borres el archivo .db sin mi aprobación expresa.

## Stack
- **Node.js 22.5+** (ESM, sin TypeScript, sin build step)
- **Express 4** para el backend
- **node:sqlite** integrado en Node (módulo experimental; no usar better-sqlite3 sin preguntarme)
- **@libsql/client** para Turso (solo en producción/producción; en local no se usa)
- **bcryptjs** (no bcrypt nativo), **cookie-parser**, **helmet**, **express-rate-limit**
- Frontend: HTML + CSS + JS puro en `public/` (SPA sin framework, servida por Express)

## Comandos
```bash
npm start           # arranca en http://localhost:3000
npm run dev         # arranca con --watch (recarga automática)
npm test            # integración + e2e sobre BD temporal (no toca data/chamalu.db)
npm run test:integracion
npm run test:e2e    # requiere el servidor corriendo
npm run test:smoke  # prueba de humo del frontend (Chrome/Edge headless + CDP)
./release.sh patch|minor|major  # release: respaldo, versión, commit y tag (Git Bash)
```
No hay `npm run build` ni script de lint. Las pruebas corren con `node --test`.

## Configuración
- `.env` se carga automáticamente con `process.loadEnvFile()` (built-in de Node 20.6+)
- Si `SESSION_SECRET` no existe, se genera uno aleatorio y se guarda en `.env`
- Variables: `PORT`, `SESSION_SECRET`, `SESSION_TIMEOUT_MIN`, `NODE_ENV`
- Ejemplo en `.env.example`

## Base de datos
- Adaptador dual en `server/config/db.js`:
  - **Local** (desarrollo/pruebas): SQLite en disco con `node:sqlite` (síncrono)
  - **Remoto** (Vercel + Turso): libSQL con `TURSO_URL` y `TURSO_TOKEN`
  - API idéntica en ambos modos: `prepare().get/all/run`, `exec()` y `transaccion(fn, {inmediata})`. Usar siempre `await` (funciona con valor síncrono y con promesa)
- Archivo SQLite local: por defecto **`data/dev.db`** en desarrollo y `data/chamalu.db` si `NODE_ENV=production` (no existe en el modo remoto)
- **`data/chamalu.db` contiene los datos reales del bar**: no borrarlo ni recrearlo (se migra a Turso en H4). `data/dev.db` es solo de desarrollo/pruebas
- Migraciones en `/migrations` (numeradas) con registro en la tabla `migrations_aplicadas`; se aplican una sola vez al arrancar
- El usuario propietario inicial se crea automáticamente: **admin / admin123** (solo en una BD nueva; nunca dejarla así en producción)
- El admin inicial queda marcado con `debe_cambiar_password`: debe cambiar la clave en su primer ingreso (bloqueo también en el servidor)
- Las tablas se crean con `CREATE TABLE IF NOT EXISTS` en `server/config/db.js`
- WAL mode + foreign keys activados al arrancar
- Sesiones expiradas se borran automáticamente (al arrancar y cada 30 min)
- Copias de seguridad: se crean desde Configuración (`VACUUM INTO`) en `data/backups/`, se conservan las últimas 10
- Para las pruebas, `db.js` acepta la variable `DB_PATH` y Configuración acepta `BACKUPS_DIR` (así `npm test` usa una BD temporal y no toca la real)

## Estructura
```
server.js               → entrypoint para Vercel (exporta la app; local no se usa)
vercel.json             → config de Vercel (cron diario de mantenimiento)
release.sh              → release: respaldo (VACUUM INTO), sube versión, commit y tag
migrations/             → migraciones SQL numeradas (001_pagos_venta, 002_inversiones…)
server/
  app.js              → arranque, middleware, montaje de rutas, export default app
  config/db.js        → conexión SQLite + schema + migraciones + seed
  config/almacen.js   → almacén dual de imágenes (uploads local / Vercel Blob remoto)
  config/constants.js → roles, módulos, nowCO(), sumarMinutos()
  middlewares/        → auth.js, roles.js, rateLimit.js, auditoria.js, csrf.js
  routes/             → auth, caja, categorias, productos, mesas, cuentas,
                        ventas, inventario, gastos, alertas, usuarios,
                        configuracion, dashboard, reportes, inversiones
public/
  index.html          → SPA (login + shell)
  manifest.json       → manifiesto PWA
  sw.js               → service worker (PWA)
  icon-192.png        → icono PWA
  icon-512.png        → icono PWA
  css/                → variables, layout, components
  js/                 → app.js (orquestador + menú lateral ocultable ☰), api.js, state.js, ui.js
  js/modules/         → inicio, auth, facturacion (catálogo + venta actual en 2
                        columnas y barra de pestañas), gestion, mesas, ventas,
                        reportes, caja, alertas, usuarios, configuracion,
                        inversiones, recortador
  img/                → logo-default.svg, producto-default.svg
  uploads/            → imágenes subidas por el propietario
tests/                → integracion.test.js, e2e.test.js, run-all.mjs, smoke-frontend.mjs (node --test)
data/                 → dev.db (desarrollo/pruebas) y chamalu.db (datos reales, no borrar)
  backups/            → copias de seguridad (no se versionan)
BUGS.md               → registro de bugs y errores corregidos
README.md             → guía de instalación, uso, .env, backups y seguridad
decisiones.txt        → preguntas del propietario y respuestas aprobadas
```

## Zona horaria
- Colombia es UTC-5 todo el año (sin horario de verano)
- Usar `nowCO()` de `server/config/constants.js` para timestamps
- Formato en BD: `YYYY-MM-DD HH:MM:SS`

## Roles y módulos
- `MODULOS_POR_ROL` en `constants.js` define qué ve cada rol
- CAJERO ve: inicio, facturacion, ventas, gestion (solo consulta), alertas
- CAJERO no ve: caja, reportes, usuarios, configuración; dentro de Gestión no administra categorías, no crea/edita productos ni ve el precio de compra
- El filtro se hace en el servidor, no solo ocultando botones en el frontend

## Convenciones
- Dinero en enteros (COP, sin decimales)
- Sin dependencias nuevas sin preguntar primero
- Código con comentarios en español donde ayuden
- El servidor sirve `public/` como estáticos — no hay bundle ni transpiler
