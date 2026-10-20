# Resultados de Tests - Chamalú Beer

Fecha: 2026-10-12

Comando recomendado: `npm test` (integración + end-to-end sobre una base temporal, sin tocar `data/chamalu.db`).

## 1. Tests de integración

Comando: `node --test tests/integracion.test.js`

- **Tests totales:** 14
- **Pasaron:** 14
- **Fallaron:** 0

### Detalle por Suite
- **Base de Datos (3/3):** las tablas principales existen; el usuario admin existe; existen los índices de optimización.
- **Autenticación y Seguridad (3/3):** contraseñas hasheadas con bcrypt; tokens de sesión únicos; existe la columna `debe_cambiar_password`.
- **Productos y Categorías (3/3):** crear categoría; crear producto; precio de venta presente.
- **Mesas y Ventas (2/2):** crear mesa; la venta registra el usuario que la hizo.
- **Inventario (1/1):** los movimientos registran stock anterior y nuevo.
- **Auditoría (1/1):** el log de auditoría registra acciones.
- **Configuración (1/1):** se puede guardar configuración.

## 2. Test end-to-end (HTTP)

Comando: `node --test tests/e2e.test.js` (o `npm run test:e2e`; **requiere el servidor encendido** en http://localhost:3000)

- **Tests totales:** 1 (flujo completo)
- **Pasaron:** 1
- **Fallaron:** 0

Cubre: login de propietario (y cambio obligatorio si aplica), bloqueo sin sesión,
**rechazo CSRF por Origin ajeno**, apertura de caja, **editar apertura de caja
(el propietario sí, el cajero no)**, crear categoría/producto/mesa, abrir mesa,
agregar items, **quitar un producto de la cuenta**, cobrar en efectivo con
cambio, descuento de stock, venta registrada, caja chica (salida válida y
rechazo por saldo insuficiente), entrada de inventario, crear cajero, módulos
limitados del cajero, filtro de categorías en el servidor, ocultar
`precio_compra`, el cajero no cambia su contraseña pero sí su perfil, **copia
de seguridad (el propietario sí, el cajero no)** y cierre de caja con cálculo de
diferencia.

## 3. Prueba de humo del frontend

Comando: `npm run test:smoke` (o `node tests/smoke-frontend.mjs`)

- **Pestañas recorridas:** 11
- **Pasaron:** 11
- **Fallaron:** 0
- **Errores de consola/excepción:** 0

Abre Chrome/Edge headless sobre una base temporal (con datos de ejemplo),
inicia sesión, abre caja y hace clic en cada módulo del menú. Falla si alguna
pestaña queda vacía, muestra un aviso (`toast`) de error, deja la grilla de
mesas sin dibujar o lanza errores de consola/excepciones no capturadas.
No toca `data/chamalu.db`.

## 4. Verificación adicional de la Fase 8

- Flujo de contraseña obligatoria probado sobre una base de datos nueva: login del
  admin → `debe_cambiar_password = true` → acceso bloqueado (403) → cambio de
  contraseña (200) → acceso permitido (200) → marca borrada.
- Backups: el archivo se crea en `data/backups/` y aparece en la lista.

## Estado del Servidor
- URL: http://localhost:3000
- Usuario: admin / admin123
- Rol: PROPIETARIO

## Fases Implementadas
- Fase 1: Login, sesiones, seguridad
- Fase 2: Productos y categorías
- Fase 3: Mesas, cuentas y cobro
- Fase 4: Historial de ventas e inventario
- Fase 5: Caja, caja chica y gastos
- Fase 6: Alertas y panel principal (Inicio)
- Fase 7: Usuarios y configuración
- Fase 8: Auditoría de seguridad, backups, CSRF, limpieza de sesiones y contraseña obligatoria
- Ajustes: editar apertura de caja (solo propietario), quitar productos de la cuenta, `npm test`, índices de optimización y `README.md`
