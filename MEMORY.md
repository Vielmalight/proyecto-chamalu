# Memoria del proyecto - Chamalú Beer

## Estado actual
- **Fase H (publicación en Vercel) en curso**: **H1** capa BD dual local/async ✅ · **H2** fotos y backups a Vercel Blob ✅ · **H3** runtime Vercel ✅ · **H4** cuentas y migración de datos (pendiente).
- **Fase G (tercera ronda de criticas) completada**: **G1** (cambios simples) ✅ · **G2** (mesas con zonas) ✅ · **G3** (recorte/edición de imagen de producto) ✅.
- Las decisiones de la Fase G están todas respondidas en `decisiones.txt` (aprobadas por el propietario).
- Versión de la app: **2.0.0** (`package.json`, única fuente; visible en el pie del menú lateral y en el login).
- La **Fase 3** quedó cerrada: Fases A (arreglos y pulido), B (rediseño UX), C (Facturación/POS) y D (Inicio/dashboard) completadas.
- Fases 1 a 8, Fase 2 (Fase 9), Fase E y el pase de diseño visual completados.
- Última actualización: 2026-10-20

## Decisiones tomadas
- Stack: Node.js 22.5+ (ESM) + Express 4 + node:sqlite + frontend HTML/CSS/JS puro (sin framework, sin build).
- Sesiones: cookie HttpOnly `sid` con token aleatorio guardado en la tabla `sesiones`; expiración por inactividad (`SESSION_TIMEOUT_MIN`); limpieza automática de sesiones expiradas (al arrancar y cada 30 min).
- Seguridad: bcryptjs para contraseñas, rate-limit en login (5 intentos/15 min), auditoría en acciones clave (incluye login y login fallido), rol verificado en el servidor (no solo en el frontend).
- El admin inicial se crea con la marca `debe_cambiar_password`: en su primer ingreso debe cambiar la contraseña antes de usar el resto del sistema (bloqueo también en el servidor).
- CSRF: se verifica el header `Origin` en peticiones que cambian datos (sin librerías). Clientes sin `Origin` (tests/curl) se permiten.
- Copias de seguridad manuales desde Configuración con `VACUUM INTO` en `data/backups/`, conservando las últimas 10 (no se versionan en Git).
- Dinero en enteros COP; operaciones críticas con transacción atómica (`BEGIN IMMEDIATE`).
- Gastos se manejan dentro del módulo **Caja** (no hay módulo "Gastos" aparte en el menú).
- Panel principal (Inicio) usa un único endpoint `GET /api/dashboard/resumen` calculado en el servidor con `nowCO()`.
- Interfaz (punto 8C): barra inferior de **mesas activas** como pestañas. **Retirada en Fase 3 (Fase A)**: la gestión de mesas se moverá dentro de Facturación (Fase C). Módulos a la izquierda, área de trabajo en el centro. Se pueden **añadir y quitar** productos de la cuenta mientras esté abierta.
- Fase 3 - Fase A (arreglos y pulido):
  - Usuarios: los **propietarios no se pueden desactivar** (bloqueo en servidor + UI); se puede **reactivar** cajeros; botón **Eliminar**. La eliminación desvincula referencias opcionales (inventario, caja chica, gastos, auditoría → `usuario_id = NULL`) y borra sus sesiones; si tiene historial obligatorio (ventas/cuentas/turnos) devuelve error y hay que desactivarlo. No puedes eliminarte a ti mismo y debe quedar ≥1 propietario.
  - Ventas: se muestra **Cambio: $X** o "Sin cambio" (en lista y detalle, solo efectivo).
  - Alertas: filtros **No leídas / Leídas / Todas** y botones **Marcar leída / Marcar no leída** (endpoint `/api/alertas/:id/no-leer`). `GET /api/alertas?filtro=` admite `no-leidas` (por defecto), `leidas`, `todas`.
  - Cobro: "Recibido" solo aparece al elegir **Efectivo**, con línea de **Cambio** calculada en vivo (elimina la redundancia de "Paga con (efectivo)").
  - Mesas: **Eliminar** para propietario; bloquea si la mesa está ocupada o tiene cuentas asociadas (no se borran mesas con historial).
  - Configuración: logo con **botón estilizado + vista previa**; al subir se refresca el logo de la barra superior.
- Fase 3 - Fase B (rediseño UX):
  - **Menú lateral agrupado** (Opción 1, solo visual): *Operación* (Inicio·Mesas·Ventas·Caja) / *Catálogo* (Productos·Inventario) / *Análisis* (Reportes·Alertas) / *Sistema* (Usuarios·Configuración), con contador de alertas. Implementado con `GRUPOS_MENU` + `renderSidebar()` en `public/js/app.js`. No mueve módulos ni fusiona nada (eso es Fase C).
  - **Sistema de tokens CSS** en `public/css/variables.css` (espaciado, radios, sombras, tipografía, transiciones y variantes *soft* para éxito/peligro/aviso, en claro y oscuro); layout reescrito en `layout.css` (`.app-view` a `100vh` con scroll interno, `.menu-grupo`, `badge-alertas`) y capa de componentes en `components.css` (tarjetas-resumen, items con hover, mesas, dashboard, config).
  - **Blindaje anti‑carrera** en el frontend: varios módulos adjuntaban listeners o leían `getElementById` **después de un `await`**; al cambiar de pestaña rápido el nuevo render quedaba con referencias nulas. Se corrigió con encadenamiento opcional (`?.`) y guardas (`if (!el) return;`). Es el patrón a mantener en módulos nuevos.
- Fase 3 - Fase C (Facturación/POS):
  - **Decisión de stock (A=2)**: el stock **baja al agregar** un producto a la cuenta y **se devuelve al quitarlo/cancelar** (no al cobrar). `POST /:id/cobrar` ya no descuenta stock.
  - **Cliente opcional** (B=2): si no se escribe, la cuenta queda como **"Mostrador"**.
  - **Varias cuentas sin mesa** a la vez (C=1); cuenta sin mesa se guarda con `mesa_id` NULL y `tipo = 'MOSTRADOR'`.
  - La pestaña fusiona Productos+Inventario bajo el nombre **"Gestión"** (D=1); abrir un producto muestra su **kardex**; se elimina la pestaña "Categorías" (queda dentro de Gestión con chips + botón "Administrar categorías").
  - **Facturación solo en computador** (F=1): en `≤900px` se muestra un aviso y no se puede facturar (en celular solo administrar/consultar).
  - **Botón "Cobro directo"** (H=sí): cobro en efectivo sin pedir más datos. **(eliminado después: ver Fase E2)**
  - Backend (`server/routes/cuentas.routes.js` reescrito): `GET /`, `POST /` (mesa o mostrador), `GET /:id`, `POST /:id/items`, **`PUT /:id/items/:itemId`** (ajusta cantidad; 0 = quitar), **`DELETE /:id/items/:itemId`**, **`DELETE /:id`** (cancela cuenta abierta sin ventas, devuelve stock y libera mesa), `POST /:id/cobrar`, `POST /rapida` (venta rápida atómica). Kardex: `GET /inventario/movimientos?producto_id=`.
  - Migración `migrarCuentasFacturacion()` en `db.js`: agrega `cliente`, `tipo` y `mesa_id` opcional a `cuentas_mesa` conservando datos; el índice `idx_cuentas_estado` se crea **dentro de la migración** (no en el `CREATE TABLE` grande) para no fallar con BD antiguas.
  - `MODULOS` = `inicio, facturacion, gestion, mesas, ventas, reportes, caja, alertas, usuarios, configuracion`; `MODULOS_POR_ROL.CAJERO` = `inicio, facturacion, ventas, gestion, alertas`.
     - Frontend: **`public/js/modules/facturacion.js`** (POS 3 columnas: catálogo con chips y buscador / venta con +−/cantidad/quitar y total / aside cliente-cajero-origen, mesas y pendientes) y **`public/js/modules/gestion.js`** (Productos + Kardex + Categorías). Menú: *Operación* (Inicio·Facturación·Ventas·Caja) / *Catálogo* (Gestión) / *Análisis* (Reportes·Alertas) / *Sistema* (Mesas·Usuarios·Configuración).
- Fase 3 - Fase D (Inicio/dashboard):
  - Inicio muestra **hoy vs ayer** (ventas y ganancia con **% de variación**), **pérdidas del día** y **cuentas pendientes por cobrar**, además de mesas, stock bajo, alertas y turno de caja. Un solo endpoint `GET /api/dashboard/resumen` (función exportada `calcularResumen(usuario)` en `dashboard.routes.js` para pruebas).
  - **Ganancia** = ventas netas PAGADAS − costo de lo vendido (`SUM(ic.cantidad * p.precio_compra)`, ítems `anulado = 0`); sirve para mesa y venta rápida.
  - **Pérdida** = gastos del día + `SUM(ABS(turnos_caja.diferencia))` de turnos cerrados hoy (**cualquier** descuadre, en valor absoluto, B=2). Las **anulaciones NO** cuentan como pérdida (C=2).
  - El **cajero** recibe el resumen **sin** ganancia, pérdida, gastos ni caja (A=1). Frontend: `public/js/modules/inicio.js`; estilos de variación (`var-up`/`var-down`) en `components.css`.
- Fase E - Fase E1 (bugs y ajustes simples; `criticas.md`, "Segunda fase de críticas"):
  - **Inicio** (`inicio.js`): el bug `Cannot read properties of undefined (reading 'ventas')` venía de un **servidor viejo** sirviendo el formato anterior del dashboard. Se **blindó** el frontend con valores por defecto (`r.hoy?.ventas ?? 0`, etc.); recordar **reiniciar el servidor** tras desplegar.
  - **Ventas**: se muestra **apodo + ROL** del vendedor (`ventas.routes.js` agrega `usuario_apodo` / `usuario_rol`; frontend `ventas.js`, lista y detalle).
  - **Fechas**: los filtros de Ventas y Reportes arrancan en **hoy (Colombia)** y saltan solos al día nuevo a medianoche. Helpers `hoyCO()` y `vigilarCambioDeDia()` en `ui.js`.
  - **Reportes por usuario**: orden fijo por usuario (`ORDER BY u.id`, antes por total).
  - **Alertas**: se quitó el chip "Todas" (quedan No leídas / Leídas).
  - **Mesas**: se quitaron los botones de la tarjeta; al tocar la tarjeta se abre un **menú de acciones** (Abrir / Ver cuenta / Editar / Eliminar / Cerrar, según estado y rol).
  - **Caja**: nueva sección **"Historial de turnos cerrados"** + `GET /api/caja/turnos` (solo propietario); esperado = declarado − diferencia.
  - **Categorías/filtro**: `GET /api/categorias` ahora exige solo **sesión** (`requireAuth`), no propietario, para que el cajero pueda filtrar; Gestión y Facturación filtran **siempre por `categoria_id`** (se eliminó el respaldo por nombre).
  - **Scroll**: `.modal` con `max-height` y `overflow-y: auto` para no depender de pantalla completa.
- Fase E - Fase E2 (rediseño de Facturación + menú ocultable):
  - **Facturación en 2 columnas** (catálogo a la izquierda, "Venta actual" a la derecha) y **barra de pestañas abajo** (`public/js/modules/facturacion.js` reescrito). Estado en memoria: `tabActiva`, `defaultCuentaId`, `cuentasAbiertas`.
  - **`[Por defecto]`** es una pestaña **fija y multifuncional**: sirve para **ventas rápidas sin mesa** y se respalda con una cuenta de mostrador que se crea perezosamente al primer producto (`asegurarDefault()`); al cobrar/cancelar se reinicia a `null`.
  - **`+` único** abre el **modal de mesas** (cuenta nueva si está libre, o la existente si está ocupada). Se **eliminó** la venta sin mesa adicional (el `+` viejo y `nuevaVentaDesdeDefault()`), por considerarse innecesaria.
  - **Editar** en "Venta actual" abre un modal para asignar **mesa y/o cliente** a la pestaña; mesa ocupada por otra cuenta queda deshabilitada.
  - **Origen visible**: la etiqueta muestra "Por defecto (venta rápida)" o "Mesa N".
  - Se **quitó** el campo fijo "Cliente" y el botón **"Guardar y liberar"**. Se mantiene **"Cobrar"** (el efectivo se cobra desde el modal con Método = Efectivo; se quitó el botón **"Cobro directo"**).
  - Backend: nuevo **`PUT /api/cuentas/:id`** (asignar/cambiar `mesa_id` y `cliente`, atómico, valida mesa libre, libera la anterior, audita `EDITAR_CUENTA`).
  - **Menú lateral ocultable (☰)**: botón en la barra superior (`index.html`); `bindMenu()` en `app.js` alterna la clase `oculto` en el sidebar y recuerda la preferencia en `localStorage` (`chamalu_menu_oculto`); al pasar el mouse por el borde izquierdo reaparece **flotante** (`.sidebar.flotante` + `#menu-hover`).
- Fase E - Fase E3 (Usuarios en línea):
  - **"En línea" = actividad en los últimos 5 minutos** (`MINUTOS_EN_LINEA` en `server/routes/usuarios.routes.js`), apoyado en `sesiones.ultima_actividad` (que `requireAuth` actualiza en cada petición autenticada).
  - `GET /api/usuarios` (solo propietario) ahora devuelve además `en_linea` (1/0) y `minutos_inactivo`; se calcula con un `LEFT JOIN sesiones` + `MAX(ultima_actividad)`.
  - Frontend `public/js/modules/usuarios.js`: badge **"En línea"** / **"Desconectado · hace X min"** y **auto-refresco cada 10 s** mientras la pestaña Usuarios está abierta (se cancela al salir). Estilo en `components.css` (`.usuario-presencia`, `.presencia-punto`).
  - **Monitoreo en vivo del cajero (`O`): cancelado** por decisión del propietario (solo "en línea", sin panel de actividad en vivo).
- Pase de diseño (visual, sin cambiar tipografía ni paleta):
  - **Tema único oscuro**: se eliminó el modo claro y el botón de tema (🌙). `variables.css` con un solo `:root` (paleta oscura actual); `state.tema = 'dark'`; se quitó `toggleTheme` de `ui.js` y `bindTema` de `app.js`; `aplicarTema()` fuerza `setTheme('dark')`.
  - **Scrollbars finas y temáticas sin flechas** en toda la app (`layout.css`): `scrollbar-width: thin` + `::-webkit-scrollbar` de 10px, pista transparente, pulgar `#3d4d68` (hover más claro), sin botones ni fondo blanco. Nuevos tokens: `--scrollbar-size/thumb/thumb-hover/track`, `--focus-ring`, `--radius-xs`.
  - **Pulido**: barra superior con borde inferior sutil en vez de sombra fuerte; grupos del menú sin mayúsculas tipo "eyebrow"; listas y tarjetas planas (borde) que solo elevan al hover; transiciones específicas (no `all`); **numerals tabulares** en dinero/cantidades; hex sueltos (`#fff`, `#16a34a`) reemplazados por tokens; `:focus-visible` global y soporte de `prefers-reduced-motion`.
  - Pruebas: `npm test` → integración **21/21** + e2e **1/1**; `npm run test:smoke` → **10/10**, 0 errores. Verificación en navegador (servidor/BD temporales): `data-theme=dark`, fondo `#0f172a`, scrollbar `rgb(61,77,104)`, sin fugas de fondo claro.
- Fase G (tercera ronda de criticas; decisiones en `decisiones.txt`):
  - **G1 (cambios simples)**:
    - Facturación: la pestaña "Por defecto" se renombró a **"Visitante"** en todas partes (pestaña, Origen, cuentas de mostrador sin cliente).
    - Facturación: al pulsar "+" con productos en "Visitante" y elegir una mesa **libre**, los productos pasan a la cuenta de esa mesa y "Visitante" queda vacía (mesa ocupada → aviso, no se une). El nombre del cliente de "Visitante" **no** se puede cambiar; al pasar a mesa sí.
    - Ventas: botón **"Ver todas"** (quita el filtro de día, orden ascendente, **paginado** de 50 en 50); por defecto arranca en modo "Ver todas".
    - Gestión: botón de imagen renovado (zona de clic/arrastrar-soltar con vista previa, `zona-imagen` en `gestion.js`).
    - Reportes: "Productos más vendidos" con selector **Más unidades / Más ingresos** (unidades por defecto), `criterio` en `reportes.js`.
    - Configuración: sección **"Gestionar cuenta"** (modal): todos los usuarios editan nombre, apodo, usuario, correo y su propia contraseña (pidiendo la actual); el **rol se muestra solo lectura** (G2 de decisiones = 1 y 2).
    - **Versionado** `MAYOR.MENOR.PARCHE`: fuente única = campo `version` de `package.json` (`server/config/version.js` → `APP_VERSION`, expuesto en `GET /api/auth/me`); visible en el **pie del menú lateral** y en el **login**. Regla: MAYOR = fases grandes/rediseños, MENOR = funciones nuevas, PARCHE = bugs. Versión actual **2.0.0**.
  - **G2 (mesas con zonas)**:
    - Columna `zona` en la tabla `mesas` con unicidad por **(zona, número)** → "Terraza 1", "Barra 2" (migración `migrarMesasZonas()` en `db.js`; el servidor ya exponía `zona`).
    - Frontend (`mesas.js`): campo **"Zona (opcional)"** en el modal Nueva/Editar (datalist con sugerencias: Terraza, Barra, Segundo piso, Salón); tarjetas **agrupadas por zona** con encabezado (`.zona-titulo`, `.grid-mesas-zona` en `components.css` con `grid-column: 1 / -1`).
    - `etiquetaMesa(numero, nombre, zona)` en `ui.js` (**opción A** aprobada): con zona → "Terraza 3" / "Terraza Juan"; sin zona → "Mesa 3" / "Mesa Juan".
    - `facturacion.js`: la zona se muestra en el picker de mesas, las pestañas, el "Origen" y el desplegable de Editar cuenta (`mesa_zona` en el estado de la cuenta).
  - **G3 (recorte/edición de imagen de producto)**:
    - **Recortador propio con canvas, sin librerías** (`public/js/modules/recortador.js`, exporta `abrirRecortador(dataUrl, alConfirmar)`): marco **cuadrado 1:1**, **zoom** (deslizador + rueda del ratón, 1x–5x), **arrastrar** (mouse y táctil con pointer events, limitado para que la imagen siempre cubra el marco), **rotar ↺/↻ en pasos de 90°** (opción A; al rotar se recentra) y **Reiniciar**. Al aplicar: recorta al marco, redimensiona a **800×800 px**, fondo blanco (JPEG no admite transparencia) y comprime a **JPEG** calidad 0.85 (baja a 0.7/0.55 si pasara de 2 MB).
    - `gestion.js`: al elegir/arrastrar una imagen se abre el recortador; lo que sale es la vista previa y la imagen guardada (`imagen_base64`). Botón **"Recortar imagen"** para reajustar (visible al editar un producto con imagen y tras recortar). El input de archivo se limpia tras cada elección para poder reelegir el mismo archivo tras cancelar.
    - Sin cambios en el servidor: sigue recibiendo `imagen_base64` igual (`productos.routes.js`).
- Caja: editar los montos de apertura (caja mayor y caja chica) **solo el propietario**, mientras el turno esté abierto; se audita con montos anteriores y nuevos (`CAJA_APERTURA_EDITADA`). El cierre recalcula el esperado con la apertura vigente. El cajero **sí** ve el monto de apertura.
- Pruebas: `npm test` usa `tests/run-all.mjs`, que corre integración y e2e sobre una **base de datos temporal** y un servidor en un puerto libre (no toca `data/chamalu.db`).
- Optimización: índices creados con `CREATE INDEX IF NOT EXISTS` en `db.js` (15 índices).
- Documentación: `README.md` con requisitos, instalación, comandos, `.env`, backups y seguridad.
- Productos y categorías: borrado lógico (`activo = 0`). El cajero no recibe `precio_compra`.
- CSP (helmet): se permite `script-src-attr 'unsafe-inline'` para que funcionen los `onclick/onchange` en línea del frontend. Bug detectado en Fase 2: `script-src-attr 'none'` bloqueaba **todos** los botones (Mesas, Ventas, Productos, etc.).
- Cierre de caja: el resumen y el cierre muestran **desglose por método de pago** + total general; el "efectivo esperado" cuenta **solo las ventas en EFECTIVO** (no datáfono/transferencia/Nequi).
- Ventas: se pueden **abrir para ver el detalle** de sus productos y **anular un solo producto** (solo propietario). Al anular un producto se devuelve el stock, se marca el ítem (`items_cuenta.anulado = 1`) y se recalcula el total; si se anulan todos, la venta queda ANULADA.
- Cobro: se acepta **descuento** (baja el total que recibe el bar) y **propina** (se cobra aparte; **no** entra a la caja ni al cierre). Columnas `ventas.descuento` y `ventas.propina`.
- Armar cuenta: la lista desplegable se reemplazó por un **buscador de productos**.
- Módulo **Reportes** (solo propietario): por rango de fechas muestra total vendido, por método, por usuario y productos más vendidos.
- Menú: la opción **Alertas** muestra un contador con las alertas sin leer.
- Responsive: se agregaron estilos para tablet/celular (`@media max-width: 600px`).
- **Nombre de mesa (Ajuste)**: el campo "Nombre del cliente" de la mesa se muestra como **"Mesa <cliente>"** en Mesas y Facturación (helper `etiquetaMesa()` en `ui.js`). El nombre se sincroniza entre `mesas.nombre_cliente` y `cuentas_mesa.cliente` (al abrir/editar la cuenta y al editar la mesa) y se **limpia al cerrar la cuenta** (cobrar, cancelar o liberar la mesa) para volver a "Mesa #". `GET /api/cuentas` ahora expone `mesa_cliente`.
- Pruebas Fase 2: integración 16/16 (incluye columnas nuevas) y e2e ampliado (descuento/propina, detalle, anulación por producto, reportes, cierre por método).
- Registro de bugs: `BUGS.md` en la raíz guarda **todos** los bugs y errores (síntoma, causa, solución, archivos y estado). Se actualiza al corregir algo.
- Prueba de humo del frontend: `npm run test:smoke` (`tests/smoke-frontend.mjs`) abre Chrome/Edge headless sobre una BD temporal, siembra datos y recorre las 11 pestañas; falla si alguna queda vacía, muestra un aviso de error o lanza errores de consola/excepciones. No toca la BD real ni el `.env`.
- Pruebas Fase 3 (Fase A): `npm test` → integración **17/17** (incluye `generarAlertas` crea alerta de stock bajo) + e2e **1/1** (incluye propietario no desactivable, borrado de cajero sin historial, mesa con historial no se elimina, filtros de alertas). `npm run test:smoke` → **11/11**, 0 errores.
- Pruebas Fase 3 (Fase B): `npm test` → integración **17/17** + e2e **1/1**; `npm run test:smoke` → **11/11**, 0 errores (el smoke detectó la carrera de render tras reordenar el menú; ver BUG-004).
   - Pruebas Fase 3 (Fase C): `npm test` → integración **19/19** (incluye `cuentas_mesa` con mostrador y `idx_cuentas_estado`) + e2e **1/1** (agrega: cuenta mostrador, stock al agregar/ajustar/quitar, cancelar devuelve stock, venta rápida y descuento inválido, cliente opcional). `npm run test:smoke` → **10/10**, 0 errores; ahora el smoke también agrega un producto en Facturación para detectar regresiones del POS.
    - Pruebas Fase 3 (Fase D): `npm test` → integración **21/21** (agrega: `calcularResumen` da ganancia = ventas − costo, pérdida = gastos + descuadres, y el cajero no recibe ganancia/pérdida) + e2e **1/1** (agrega `/api/dashboard/resumen` para propietario y cajero). `npm run test:smoke` → **10/10**, 0 errores.
    - Pruebas Fase E1: `npm test` → integración **21/21** + e2e **1/1** (el e2e #17 cambió: el cajero ahora **sí** lista categorías, pero **no** puede crearlas). `npm run test:smoke` → **10/10**, 0 errores.
    - Pruebas Fase E2: `npm test` → integración **21/21** + e2e **1/1**; `npm run test:smoke` → **10/10**, 0 errores. Verificación manual en vivo (servidor y BD temporales, sin tocar `data/chamalu.db`): 2 columnas; pestañas `[Por defecto] / + / + mesa`; agregar producto; `+` crea pestaña editable; asignar Mesa 1 → etiqueta "Mesa 1"; modal `+ mesa`; `☰` oculta y restaura el menú.
    - Pruebas Fase E3: `npm test` → integración **21/21** + e2e **1/1** (el e2e ahora comprueba que el admin conectado aparece `en_linea = 1` y que `minutos_inactivo` es numérico); `npm run test:smoke` → **10/10**, 0 errores.
    - Pruebas Ajuste nombre de mesa: `npm test` → integración **21/21** + e2e **1/1** (e2e #20o2: la mesa toma el nombre del cliente al abrir, lo cambia al editar la cuenta y lo pierde al cobrar/cancelar la cuenta); `npm run test:smoke` → **10/10**, 0 errores.
    - Pruebas Fase G (G1+G2): `npm test` → integración **25/25** (agrega bloque "Mesas con zonas (Fase G)": crear mesa con zona, rechazar duplicado zona+número, permitir mismo número en otra zona, dos sin zona no repiten número) + e2e **1/1**; `npm run test:smoke` → **10/10**, 0 errores. Revisión final: corregido `grid-column: 1 / -1` en `.zona-titulo`/`.grid-mesas-zona` para que los grupos ocupen el ancho completo.
    - Pruebas Fase G (G3): `npm test` → integración **25/25** + e2e **1/1**; `npm run test:smoke` → **10/10**, 0 errores. Revisión final: botón "Recortar" visible al editar producto con imagen; input de archivo limpio tras cada elección (permite reelegir el mismo archivo tras cancelar el recortador).
- Fase H (publicación en Vercel, decisiones aprobadas por el propietario):
  - **H1 (capa BD dual) completada**: `server/config/db.js` con adaptador dual — local `node:sqlite` (síncrono, igual que siempre) o remoto Turso/libSQL (`TURSO_URL` + `TURSO_TOKEN`), API idéntica (`prepare().get/all/run`, `exec()`, `transaccion(fn, {inmediata})`). Todas las consultas del servidor usan `await` (funciona con valor síncrono y con promesa). Transacciones (`BEGIN IMMEDIATE`) reemplazadas por `db.transaccion()` en caja, cuentas, ventas, inventario y usuarios. Errores de negocio con `e.status` respondidos sin confundirlos con error de servidor. `initSchema`/`seedAdmin`/`limpiarSesiones`/`generarAlertas`/`calcularResumen` ahora async.
  - Nueva dependencia: **`@libsql/client`** (aprobada por el propietario).
  - Plan completo de despliegue: H2 = fotos de producto y copias a **Vercel Blob**; H3 = runtime Vercel (`server.js` en la raíz, guard de `listen`, `vercel.json`, cron diario); H4 = cuentas Vercel + Turso, migrar datos locales y cambiar `admin123`.
  - El propietario tiene cuenta de GitHub; el proyecto aún **no** es repositorio git (H4 lo requiere).
- Pruebas Fase H1: `npm test` → integración **25/25** + e2e **1/1**; `npm run test:smoke` → **10/10**, 0 errores.
- Pruebas Fase H2: `npm test` → integración **25/25** + e2e **1/1**; `npm run test:smoke` → **10/10**, 0 errores.
  - **H2 (imágenes y copias a Vercel Blob) completada**: nuevo `server/config/almacen.js` con `subirImagen(base64)` dual — local escribe en `public/uploads` (sin cambios), remoto sube a **Vercel Blob público** (`imagenes/…`, CDN) y guarda la URL completa en la BD. Logo usa lo mismo. **Copias de seguridad duales**: local `VACUUM INTO` a `.db` (igual que siempre); remoto **volcado JSON privado** a Blob (`backups/chamalu-<fecha>.json`, `access: 'private'`) con listado, descarga por streaming autenticado y limpieza (últimas 10). CSP `img-src` con `https:` para las URLs de Blob. `close()` añadido al adaptador (lo usaba el smoke). Imagen anterior al editar producto se conserva (decisión C, igual que en local). La rama remota recién se probará en H4 con deploy real.
  - Nueva dependencia: **`@vercel/blob`** (aprobada).
  - **H3 (runtime Vercel) completada**: `server.js` en la raíz (Vercel lo detecta como entrypoint y exporta la app como función serverless; sin rewrites, `public/` lo sirve el CDN). `server/app.js`: `export default app`; `app.listen` y los `setInterval` solo corren sin `process.env.VERCEL` (en la nube el proceso es efímero); escritura de `.env` blindada (FS de solo lectura en Vercel); nuevo `GET /api/cron/mantenimiento` montado **antes** de `requireAuth`, validado con `Authorization: Bearer $CRON_SECRET`, ejecuta `generarAlertas()` + `limpiarSesiones()`. `vercel.json` con un cron diario `0 7 * * *`. **Límite del plan Hobby: 1 ejecución al día por cron** (precisión ±59 min); por eso en producción las alertas se generan 1 vez al día (+ en cada arranque en frío), mientras que en local siguen cada 60 s. `express.json({ limit: '5mb' })` corrige BUG-005 (el límite por defecto de 100 KB rechazaba imágenes reales). Verificación en local: cron responde 401 sin clave y 200 con clave correcta.
- Pruebas Fase H3: `npm test` → integración **25/25** + e2e **1/1**; `npm run test:smoke` → **10/10**, 0 errores. `server.js` arranca y responde.

## Fases
- [x] 1. Estructura base, Servidor y Login Seguro
- [x] 2. Categorías y Productos (con permisos)
- [x] 3. Mesas, Cuentas y Cobro (venta atómica)
- [x] 4. Historial de Ventas e Inventario (Kardex)
- [x] 5. Caja, Caja Chica y Gastos
- [x] 6. Centro de Alertas y Panel Principal (Dashboard)
- [x] 7. Gestión de Usuarios y Configuración del Bar
- [x] 8. Auditoría de Seguridad, Optimización y Pruebas Integrales
- [x] 9. Mejoras Fase 2: CSP (onclick), cierre por método de pago, detalle de venta, anulación por producto, descuento/propina, buscador de productos, módulo Reportes, contador de alertas y responsive
- [x] 10. Fase 3: arreglos y pulido (Fase A) ✅ · rediseño UX (Fase B) ✅ · Facturación/POS (Fase C) ✅ · Inicio/dashboard (Fase D) ✅
- [x] 11. Fase E (segunda ronda de críticas): bugs y ajustes simples (**E1** ✅) · rediseño de Facturación + menú ocultable (**E2** ✅) · Usuarios en línea (**E3** ✅)
- [x] 12. Pase de diseño visual: tema único oscuro, scrollbars finas sin flechas y pulido general ✅
- [x] 13. Ajuste de Facturación: `+` único abre mesas (se quitó la venta adicional por defecto) y sin botón "Cobro directo" ✅
- [x] 14. Ajuste: nombre de mesa visible como "Mesa <cliente>" ✅
- [x] 15. Fase G (tercera ronda de criticas): **G1** cambios simples ✅ · **G2** mesas con zonas ✅ · **G3** recorte/edición de imagen de producto ✅
- [ ] 16. Fase H (publicación en Vercel): **H1** capa BD dual local/Turso ✅ · **H2** fotos y backups a Vercel Blob ✅ · **H3** runtime Vercel ✅ · **H4** cuentas y migración de datos

## Estructura de archivos
```
server.js               → entrypoint para Vercel (importa server/app.js y exporta la app)
vercel.json             → config de Vercel (cron diario de mantenimiento)
server/
  app.js              → arranque, middleware, montaje de rutas, export default app (listen/intervals solo en local), endpoint /api/cron/mantenimiento
  config/db.js        → adaptador dual SQLite local / Turso remoto + schema + migraciones + seed admin + limpiarSesiones() + transaccion()
  config/almacen.js   → almacén dual de imágenes (uploads local / Vercel Blob remoto)
  config/constants.js → roles, módulos por rol, nowCO(), sumarMinutos()
  middlewares/        → auth.js, roles.js, rateLimit.js, auditoria.js, csrf.js
  routes/             → auth, caja, categorias, productos, mesas, cuentas,
                        ventas, inventario, gastos, alertas, usuarios,
                        configuracion, dashboard, reportes
public/
  index.html          → SPA (login + shell)
  css/                → variables.css, layout.css, components.css
  js/                 → app.js, api.js, state.js, ui.js
  js/modules/         → inicio, auth, facturacion, gestion, mesas, ventas,
                        reportes, caja, alertas, usuarios, configuracion,
                        recortador (recorte de imagen con canvas)
  img/                → logo-default.svg, producto-default.svg
  uploads/            → imágenes subidas por el propietario
tests/
  integracion.test.js → pruebas de BD/schema (node --test)
  e2e.test.js         → flujo HTTP completo (requiere servidor corriendo)
  run-all.mjs         → lanzador de `npm test` (BD temporal + servidor propio)
  smoke-frontend.mjs  → prueba de humo del frontend (Chrome headless + CDP)
  RESULTADOS.md       → resultados documentados
data/                 → chamalu.db (se crea solo)
  backups/            → copias de seguridad (no se versionan)
BUGS.md               → registro de bugs y errores corregidos
README.md             → guía de instalación, uso, .env, backups y seguridad
```

## Pendientes y problemas conocidos
- Ninguno crítico. Para desplegar: cambiar la contraseña del admin (el sistema lo exige en el primer ingreso) y no subir `.env`, `data/*.db` ni `data/backups/` (ya están en `.gitignore`).
- CSRF: se mantiene solo la verificación de `Origin` (decidido). Tiene sentido añadir un token por sesión solo si el sistema se expone a Internet (no es el caso hoy).
- El flujo de decisiones vive en `decisiones.txt`: yo escribo las preguntas (A, B, C…) y el propietario responde bajo `R:`; solo él decide.
