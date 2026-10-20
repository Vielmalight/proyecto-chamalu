# Registro de bugs y errores - Chamalú Beer

Control de **todos** los bugs y errores detectados en el desarrollo: qué pasó,
por qué, cómo se corrigió y en qué archivos. Se actualiza cada vez que se
corrige algo. Las nuevas entradas se agregan al final con el siguiente número.

## Resumen

| ID | Título | Gravedad | Estado | Fecha |
|----|--------|----------|--------|-------|
| BUG-001 | El CSP bloqueaba los botones (onclick/onchange) | Alta | Corregido | 2026-10-12 |
| BUG-002 | Pestaña Mesas vacía por variable fuera de ámbito | Alta | Corregido | 2026-10-13 |
| BUG-003 | Mismo patrón de variable fuera de ámbito en Ventas | Alta | Corregido | 2026-10-12 |
| BUG-004 | Listeners/lecturas tras `await` fallan al cambiar de pestaña rápido | Media | Corregido | 2026-10-13 |
| TEST-001 | Aserción de stock incorrecta en la prueba e2e | Baja | Corregido | 2026-10-12 |
| BUG-005 | `express.json()` sin límite: imágenes >100 KB rechazadas (413) | Media | Corregido | 2026-10-20 |

Gravedad: **Alta** (rompe una función), **Media** (afecta parcialmente),
**Baja** (detalle/cosmético o solo en pruebas).

---

## Detalle

### BUG-001 - El CSP bloqueaba los botones (onclick/onchange)
- **Fecha:** 2026-10-12 (Fase 2).
- **Síntoma:** las secciones Mesas y Ventas no respondían; los botones con
  manejadores en línea (`onclick`/`onchange`) no hacían nada en ningún módulo.
- **Causa:** `helmet` aplicaba por defecto `script-src-attr 'none'` en el CSP,
  lo que bloquea **todos** los atributos en línea del HTML (había 14 en 7
  módulos del frontend).
- **Solución:** permitir los manejadores en línea en el CSP:
  `contentSecurityPolicy.directives.scriptSrcAttr = ["'unsafe-inline'"]`.
- **Archivos:** `server/app.js`.
- **Estado:** Corregido.

### BUG-002 - Pestaña Mesas vacía por variable fuera de ámbito
- **Fecha:** 2026-10-13.
- **Síntoma:** al abrir Mesas no se dibujaba ninguna tarjeta (grilla vacía) y
  aparecía un aviso de error. Solo ocurría cuando **había al menos una mesa**.
- **Causa:** en `public/js/modules/mesas.js`, la función `cargarMesas()` usaba la
  variable `esPropietario`, pero esta solo estaba declarada dentro de
  `renderMesas()`. Al construir la plantilla de cada mesa se lanzaba
  `ReferenceError: esPropietario is not defined`, que se capturaba y dejaba la
  grilla sin contenido.
- **Solución:** declarar `const esPropietario = state.usuario.rol === 'PROPIETARIO'`
  dentro de `cargarMesas()`.
- **Archivos:** `public/js/modules/mesas.js`.
- **Estado:** Corregido.

### BUG-003 - Mismo patrón de variable fuera de ámbito en Ventas
- **Fecha:** 2026-10-12 (detectado al reescribir el módulo en la Fase 2).
- **Síntoma:** la lista de Ventas no se dibujaba (mismo caso que BUG-002).
- **Causa:** `cargarVentas()` en `public/js/modules/ventas.js` usaba
  `esPropietario` sin declararla en su propio ámbito.
- **Solución:** declarar `const esPropietario = state.usuario.rol === 'PROPIETARIO'`
  dentro de `cargarVentas()` (y en `dibujar()` del detalle de venta).
- **Archivos:** `public/js/modules/ventas.js`.
- **Estado:** Corregido.

### BUG-004 - Listeners/lecturas tras `await` fallan al cambiar de pestaña rápido
- **Fecha:** 2026-10-13 (Fase 3, Fase B; detectado por el smoke al reordenar el menú).
- **Síntoma:** al cambiar de pestaña muy rápido (p. ej. Productos → Inventario),
  aparecía en consola `TypeError: Cannot read properties of null (reading
  'addEventListener')` y la pestaña podía quedar a medio dibujar.
- **Causa:** el nuevo menú agrupado cambió el orden de render. Varios módulos
  hacían `container.querySelector(...).addEventListener(...)` o
  `document.getElementById(...).value` **después de un `await api(...)`**. Si el
  usuario cambiaba de módulo dentro de ese intervalo, el `#content` ya había sido
  reemplazado y esas referencias eran `null` (o pertenecían a un nodo ya
  desconectado). El que se manifestó de forma determinista fue `productos.js`.
- **Solución:** usar encadenamiento opcional (`?.addEventListener`) y guardas de
  salida (`if (!el) return;`) tras cada `await`, de modo que un render obsoleto
  simplemente termina sin tocar el DOM. Aplicado a `productos.js` (causa
  concreta) y, de forma preventiva al mismo patrón, a `caja.js`,
  `configuracion.js`, `inventario.js`, `ventas.js`, `usuarios.js`,
  `categorias.js`, `mesas.js` e `inicio.js`.
- **Archivos:** `public/js/modules/*.js`.
- **Estado:** Corregido.

### TEST-001 - Aserción de stock incorrecta en la prueba e2e
- **Fecha:** 2026-10-12 (Fase 2).
- **Síntoma:** la prueba e2e fallaba al comparar el stock tras cobrar.
- **Causa:** la prueba capturaba el stock **después** de operar en lugar de
  antes, por lo que la resta no cuadraba.
- **Solución:** capturar `stockAntes` antes del cobro y comprobar
  `stockAntes - 1`.
- **Archivos:** `tests/e2e.test.js`.
- **Estado:** Corregido.

### BUG-005 - `express.json()` sin límite: imágenes >100 KB rechazadas (413)
- **Fecha:** 2026-10-20 (Fase H3, detectado al revisar el código para Vercel).
- **Síntoma:** al guardar un producto con una foto real (recortada a 800×800),
  el servidor podía responder `413 Payload Too Large` y la imagen no se guardaba.
- **Causa:** `express.json()` se usaba sin `limit`, y el valor por defecto de
  Express es **100 KB**. El JSON con la imagen en base64 (que aumenta ~33%)
  supera ese tamaño fácilmente con cualquier JPEG de foto.
- **Solución:** subir el límite a 5 MB:
  `app.use(express.json({ limit: '5mb' }))`.
- **Archivos:** `server/app.js`.
- **Estado:** Corregido (latente; no se había reportado en uso real).

---

## Notas de comportamiento (no son bugs)

Decisiones de diseño que conviene recordar para no reportarlas como errores.

### FASE 3 - Fase A (2026-10-13)
- **Usuarios:** los propietarios **no se pueden desactivar**; un propietario solo
  se puede eliminar si queda ≥1 propietario y no puedes eliminar tu propia cuenta.
  Al eliminar un usuario se desvinculan las referencias **opcionales**
  (`movimientos_inventario`, `movimientos_caja_chica`, `gastos`, `logs_auditoria`
  → `usuario_id = NULL`) y se borran sus sesiones. Si el usuario tiene historial
  **obligatorio** (ventas, cuentas o turnos de caja) la eliminación se rechaza con
  el mensaje "tiene historial; desactívalo en su lugar" (integridad histórica).
- **Mesas:** no se puede eliminar una mesa **ocupada** ni una que tenga cuentas
  asociadas (aunque estén cerradas). Es intencional: evita romper el histórico.
- **Alertas:** `GET /api/alertas` devuelve por defecto **solo las no leídas**
  (lo usa el contador del menú). Con `?filtro=leidas` o `?filtro=todas` se ven
  las demás. Marcar/desmarcar usa `POST /api/alertas/:id/leer` y `/no-leer`.
- **Cobro:** el campo "Recibido" solo se muestra en **Efectivo**; en los demás
  métodos se oculta y no se exige monto recibido.

### FASE 3 - Fase B (2026-10-13)
- **Menú agrupado:** el menú lateral ahora tiene 4 grupos (*Operación, Catálogo,
  Análisis, Sistema*). Es **solo visual**: ningún módulo cambió de lugar ni se
  fusionó (Productos+Inventario y la eliminación de Categorías son de la Fase C).
- **Patrón de los módulos:** al terminar de renderizar un módulo, sus listeners y
  lecturas de DOM deben ir con `?.` y guardas tras cada `await`. Un render
  obsoleto debe salir en silencio, no tocar el DOM ni lanzar error.

---

## Prevención (regresión)

Tras BUG-002 se añadió una **prueba de humo del frontend**
(`npm run test:smoke`, ver `tests/smoke-frontend.mjs`) que recorre las 11
pestañas en un navegador headless y falla si alguna queda vacía, muestra un
aviso de error o lanza errores de consola/excepciones. Es la red de seguridad
para este tipo de fallos (errores en tiempo de ejecución del frontend que las
pruebas HTTP no alcanzan a ver). El smoke fue además el que descubrió BUG-004 al
reordenar el menú.
