# Chamalú Beer

Sistema de inventario, ventas y caja para el bar Chamalú Beer. Node.js + Express + SQLite, con un frontend web sin framework servido por el mismo servidor.

## Requisitos

- **Node.js 22.5 o superior** (usa el módulo integrado `node:sqlite`).
- No requiere ninguna base de datos externa: SQLite se crea sola.

## Instalación

```bash
npm install
```

## Uso

```bash
npm start     # arranca en http://localhost:3000
npm run dev   # igual, pero recarga sola al guardar cambios
```

Al entrar por primera vez:

- Usuario inicial: **admin / admin123**
- El sistema te obliga a **cambiar esa contraseña** en el primer ingreso.

> Nunca dejes el sistema en producción con la contraseña por defecto.

## Pruebas

```bash
npm test                # corre integración + end-to-end sobre una base temporal
npm run test:integracion
npm run test:e2e        # requiere el servidor corriendo
npm run test:smoke      # prueba de humo del frontend (Chrome/Edge headless)
```

`npm test` **no toca** `data/chamalu.db`: crea una base temporal, levanta el servidor en un puerto libre y la borra al terminar.

`npm run test:smoke` recorre las pestañas de la interfaz en un navegador headless y falla si alguna queda vacía, muestra un aviso de error o lanza errores de consola. También usa una base temporal. Requiere Google Chrome o Microsoft Edge instalado (o definir `CHROME_PATH`); si no hay navegador, la prueba se omite con un aviso.

## Configuración (.env)

El archivo `.env` se carga solo (`process.loadEnvFile()`). Si no existe `SESSION_SECRET`, se genera uno automáticamente y se guarda.

| Variable | Descripción | Por defecto |
| --- | --- | --- |
| `PORT` | Puerto del servidor | `3000` |
| `SESSION_SECRET` | Clave para firmar/validar sesiones | se genera solo |
| `SESSION_TIMEOUT_MIN` | Minutos de inactividad antes de cerrar sesión | `120` |
| `NODE_ENV` | Entorno (`production` activa cookies seguras) | — |
| `DEV_USER` | Usuario del panel privado `/panel-dev` (sin esto, el panel da 404) | — |
| `DEV_PASSWORD_HASH` | Contraseña del panel en hash bcrypt | — |
| `DEV_SESSION_TIMEOUT_MIN` | Minutos de inactividad del panel (5–720) | `60` |

Ejemplo en `.env.example`.

## Base de datos

- Archivo: `data/chamalu.db` (se crea solo).
- Se activa modo WAL y claves foráneas al arrancar.
- Las sesiones expiradas se borran al arrancar y cada 30 minutos.
- Copias de seguridad: **manuales** desde Configuración (`VACUUM INTO`), guardadas en `data/backups/` (se conservan las últimas 10).

## Roles

- **PROPIETARIO**: acceso completo (categorías, caja, gastos, usuarios, configuración, backups).
- **CAJERO**: inicio, productos, mesas, ventas, inventario y alertas. No ve categorías, caja, gastos, usuarios ni configuración. No recibe el precio de compra.

## Seguridad

- Contraseñas con `bcryptjs`; el cajero no puede cambiar su contraseña (la asigna el propietario).
- Límite de intentos de login y prueba de rol en el servidor (no solo en el frontend).
- CSRF por verificación del header `Origin` en peticiones que cambian datos.
- Cookies `HttpOnly` + `SameSite=strict`.
- Auditoría de acciones clave (login, cambios de precio, borrados, apertura/cierre de caja, backups).

## Panel del desarrollador (`/panel-dev`)

Interruptor de acceso privado: suspende la web (mantenimiento) o la habilita de nuevo. No aparece en el menú ni en el PWA.

- Se activa solo si existen `DEV_USER` y `DEV_PASSWORD_HASH`; si faltan, la ruta responde **404**.
- Login propio con sesión aparte (`dev_sid`, 60 min de inactividad) y CSRF propio; no comparte la sesión del bar.
- Historial de los últimos 50 cambios (fecha, de activa a suspendida o viceversa, mensaje).
- Al suspender: las páginas muestran **503** con el mensaje indicado, `/api/*` responde **403** y los archivos estáticos y el cron de mantenimiento siguen disponibles. El panel nunca se bloquea.
- Generar el hash de la contraseña (pide la clave y la imprime en bcrypt):

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "TU_CLAVE"
```

En Vercel, tras cambiar estas variables hay que **redeployar**.

## Qué NO subir a GitHub

Ya están en `.gitignore`:

- `.env`
- `data/*.db` (y sus `-wal` / `-shm`)
- `data/backups/`
- `public/uploads/` (imágenes subidas)

## Estructura

```
server/
  app.js              → arranque, middleware, montaje de rutas
  config/db.js        → conexión SQLite + schema + índices + seed
  config/constants.js → roles, módulos, nowCO(), sumarMinutos()
  middlewares/        → auth, roles, rateLimit, auditoria, csrf, licencia
  routes/             → auth, caja, categorias, productos, mesas, cuentas,
                        ventas, inventario, gastos, alertas, usuarios,
                        configuracion, dashboard, reportes, dev (/panel-dev)
public/
  index.html          → SPA (login + shell)
  css/                → variables, layout, components, panel-dev
  js/                 → app.js, api.js, state.js, ui.js, pwa.js
  js/modules/         → inicio, auth, facturacion, gestion (productos y
                        categorías), mesas, ventas, reportes, caja, alertas,
                        usuarios, configuracion, recortador
tests/
  integracion.test.js → pruebas de BD/schema
  e2e.test.js         → flujo HTTP completo
  run-all.mjs         → lanzador de todas las pruebas
  smoke-frontend.mjs  → prueba de humo del frontend (Chrome headless)
data/                 → chamalu.db (se crea solo) + backups/
BUGS.md               → registro de bugs y errores corregidos
```
