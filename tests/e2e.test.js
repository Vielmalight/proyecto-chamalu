// Prueba end-to-end por HTTP. Requiere el servidor corriendo en http://localhost:3000
import { test } from 'node:test';
import assert from 'node:assert';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';

function cookieDe(res) {
  const sc = res.headers.get('set-cookie');
  return sc ? sc.split(';')[0] : '';
}

// Token CSRF por cookie de sesión (el servidor lo entrega en login y /me)
const csrfPorCookie = new Map();

async function pedir(path, { method = 'GET', body, cookie, origin, csrf } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) {
    headers.Cookie = cookie;
    const token = csrf === undefined ? csrfPorCookie.get(cookie) : csrf;
    if (token) headers['X-CSRF-Token'] = token;
  }
  if (origin) headers.Origin = origin;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  const cookieNueva = cookieDe(res);
  if (data && data.csrf_token && cookieNueva) csrfPorCookie.set(cookieNueva, data.csrf_token);
  return { status: res.status, data, cookie: cookieNueva };
}

test('Flujo completo end-to-end', async (t) => {
  const sufijo = Date.now();

  // 1) Login del propietario
  let r = await pedir('/api/auth/login', { method: 'POST', body: { usuario: 'admin', password: 'admin123' } });
  assert.strictEqual(r.status, 200, 'login admin');
  const admin = r.cookie;
  assert.ok(admin.startsWith('sid='), 'cookie de sesión admin');
  assert.strictEqual(r.data.usuario.rol, 'PROPIETARIO');

  // 1b) Si el admin inicial debe cambiar contraseña, la limpiamos (misma clave)
  if (r.data.usuario.debe_cambiar_password) {
    r = await pedir('/api/usuarios/cambiar-password', { method: 'POST', cookie: admin, body: { password_actual: 'admin123', password_nuevo: 'admin123' } });
    assert.strictEqual(r.status, 200, 'cambio obligatorio de contraseña');
  }

  // 2) Sin sesión no se puede acceder
  r = await pedir('/api/mesas');
  assert.strictEqual(r.status, 401, 'acceso sin sesión bloqueado');

  // 2b) CSRF: un Origin ajeno a los cambios se rechaza
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, origin: 'http://malicioso.com', body: { numero: 999999 } });
  assert.strictEqual(r.status, 403, 'CSRF: origen ajeno bloqueado');

  // 2c) CSRF: con sesión, un token ausente o inválido se rechaza
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, csrf: '', body: { numero: 999998 } });
  assert.strictEqual(r.status, 403, 'CSRF: token ausente bloqueado');
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, csrf: 'x'.repeat(64), body: { numero: 999998 } });
  assert.strictEqual(r.status, 403, 'CSRF: token inválido bloqueado');

  // 3) Apertura de caja (200 si abre, 409 si ya había turno)
  r = await pedir('/api/caja/apertura', { method: 'POST', cookie: admin, body: { monto_apertura: 100000, monto_caja_chica: 50000 } });
  assert.ok([200, 409].includes(r.status), 'apertura de caja');

  r = await pedir('/api/caja/resumen', { cookie: admin });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.turno, 'hay turno abierto');

  // 4) Crear categoría
  r = await pedir('/api/categorias', { method: 'POST', cookie: admin, body: { nombre: 'Bebidas ' + sufijo } });
  assert.strictEqual(r.status, 200, 'crear categoría');
  const catId = r.data.id;

  // 5) Crear producto (stock 10)
  r = await pedir('/api/productos', { method: 'POST', cookie: admin, body: {
    nombre: 'Producto ' + sufijo, categoria_id: catId, precio_compra: 2000, precio_venta: 3500, stock_actual: 10, stock_minimo: 2,
  } });
  assert.strictEqual(r.status, 200, 'crear producto');
  const prodId = r.data.id;

  // 6) Crear mesa
  const mesaNumero = (sufijo % 1000000) + 1;
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, body: { numero: mesaNumero } });
  assert.strictEqual(r.status, 200, 'crear mesa');
  const mesaId = r.data.id;

  // 7) Abrir mesa
  r = await pedir(`/api/mesas/${mesaId}/abrir`, { method: 'POST', cookie: admin });
  assert.strictEqual(r.status, 200, 'abrir mesa');

  // 8) Obtener la cuenta abierta
  r = await pedir(`/api/mesas/${mesaId}/cuenta`, { cookie: admin });
  assert.strictEqual(r.status, 200, 'ver cuenta de mesa');
  const cuentaId = r.data.cuenta.id;

  // 9) Agregar 2 unidades
  r = await pedir(`/api/cuentas/${cuentaId}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodId, cantidad: 2 } });
  assert.strictEqual(r.status, 200, 'agregar item a la cuenta');
  assert.strictEqual(r.data.subtotal, 7000);

  // 9b) Quitar un producto de la cuenta
  r = await pedir(`/api/cuentas/${cuentaId}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodId, cantidad: 5 } });
  assert.strictEqual(r.status, 200, 'agregar item extra');
  r = await pedir(`/api/mesas/${mesaId}/cuenta`, { cookie: admin });
  const itemAQuitar = r.data.items.find((i) => i.cantidad === 5).id;
  r = await pedir(`/api/cuentas/${cuentaId}/items/${itemAQuitar}`, { method: 'DELETE', cookie: admin });
  assert.strictEqual(r.status, 200, 'quitar producto de la cuenta');
  r = await pedir(`/api/mesas/${mesaId}/cuenta`, { cookie: admin });
  assert.strictEqual(r.data.total, 7000, 'total correcto tras quitar');

  // 10) Cobrar en efectivo con $10.000
  r = await pedir(`/api/cuentas/${cuentaId}/cobrar`, { method: 'POST', cookie: admin, body: { metodo_pago: 'EFECTIVO', pago_con: 10000 } });
  assert.strictEqual(r.status, 200, 'cobrar cuenta');
  assert.strictEqual(r.data.total, 7000);
  assert.strictEqual(r.data.cambio, 3000);
  const ventaId = r.data.venta_id;

  // 11) El stock bajó a 8
  r = await pedir('/api/productos', { cookie: admin });
  const prod = r.data.find((p) => p.id === prodId);
  assert.strictEqual(prod.stock_actual, 8, 'stock descontado');

  // 12) La venta quedó registrada
  r = await pedir('/api/ventas', { cookie: admin });
  assert.ok(r.data.some((v) => v.id === ventaId), 'venta registrada');
  assert.strictEqual(r.data.find((v) => v.id === ventaId).estado, 'PAGADA');

  // 13) Caja chica: salida válida y saldo insuficiente rechazado
  r = await pedir('/api/caja/chica', { method: 'POST', cookie: admin, body: { tipo: 'SALIDA', monto: 5000, descripcion: 'Hielo' } });
  assert.strictEqual(r.status, 200, 'salida caja chica');
  r = await pedir('/api/caja/chica', { method: 'POST', cookie: admin, body: { tipo: 'SALIDA', monto: 99999999, descripcion: 'x' } });
  assert.strictEqual(r.status, 400, 'caja chica no queda negativa');

  // 14) Inventario: entrada sube el stock
  r = await pedir('/api/inventario/entrada', { method: 'POST', cookie: admin, body: { producto_id: prodId, cantidad: 5, motivo: 'Compra' } });
  assert.strictEqual(r.status, 200, 'entrada de inventario');
  assert.strictEqual(r.data.stock_nuevo, 13);

  // 15) Crear usuario cajero
  r = await pedir('/api/usuarios', { method: 'POST', cookie: admin, body: { nombre: 'Cajero Test', usuario: 'cajero_test', password: 'cajero123', rol: 'CAJERO' } });
  assert.ok([200, 409].includes(r.status), 'crear cajero');

  // 16) Login del cajero y módulos limitados
  r = await pedir('/api/auth/login', { method: 'POST', body: { usuario: 'cajero_test', password: 'cajero123' } });
  assert.strictEqual(r.status, 200, 'login cajero');
  const cajero = r.cookie;
  assert.ok(!r.data.modulos.includes('caja'), 'cajero no ve caja');
  assert.ok(!r.data.modulos.includes('usuarios'), 'cajero no ve usuarios');
  assert.ok(!r.data.modulos.includes('configuracion'), 'cajero no ve configuración');

  // 16b) La sesión expone la versión de la app (SemVer) para el pie del menú
  assert.match(String(r.data.version || ''), /^\d+\.\d+\.\d+$/, 'la sesión expone la versión (SemVer)');

  // 17) El cajero SÍ puede listar categorías (las necesita para filtrar),
  //     pero NO puede crearlas (filtro en el servidor)
  r = await pedir('/api/categorias', { cookie: cajero });
  assert.strictEqual(r.status, 200, 'cajero lista categorías');
  assert.ok(Array.isArray(r.data), 'categorías es un arreglo');
  r = await pedir('/api/categorias', { method: 'POST', cookie: cajero, body: { nombre: 'SoloAdmin' } });
  assert.strictEqual(r.status, 403, 'cajero bloqueado al crear categorías');

  // 18) El cajero no recibe precio_compra
  r = await pedir('/api/productos', { cookie: cajero });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.every((p) => p.precio_compra === undefined), 'precio_compra oculto al cajero');

  // 19) El cajero no puede cambiar su contraseña
  r = await pedir('/api/usuarios/cambiar-password', { method: 'POST', cookie: cajero, body: { password_actual: 'cajero123', password_nuevo: 'nuevo123' } });
  assert.strictEqual(r.status, 403, 'cajero no cambia contraseña');

  // 20) El cajero sí puede editar su propio perfil
  r = await pedir('/api/usuarios/perfil', { method: 'PUT', cookie: cajero, body: { nombre: 'Cajero Test', apodo: 'Cajerito' } });
  assert.strictEqual(r.status, 200, 'cajero edita su perfil');

  // 20b) Editar apertura de caja: propietario sí, cajero no
  r = await pedir('/api/caja/apertura', { method: 'PUT', cookie: admin, body: { monto_apertura: 120000, monto_caja_chica: 60000 } });
  assert.strictEqual(r.status, 200, 'propietario edita la apertura');
  r = await pedir('/api/caja/apertura', { method: 'PUT', cookie: cajero, body: { monto_apertura: 1, monto_caja_chica: 1 } });
  assert.strictEqual(r.status, 403, 'el cajero no edita la apertura');

  // 20c) Cobro con descuento y propina (Fase 2 - punto H)
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, body: { numero: mesaNumero + 1 } });
  const mesaId2 = r.data.id;
  await pedir(`/api/mesas/${mesaId2}/abrir`, { method: 'POST', cookie: admin });
  r = await pedir(`/api/mesas/${mesaId2}/cuenta`, { cookie: admin });
  const cuentaId2 = r.data.cuenta.id;
  await pedir(`/api/cuentas/${cuentaId2}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodId, cantidad: 2 } });
  r = await pedir(`/api/cuentas/${cuentaId2}/cobrar`, { method: 'POST', cookie: admin, body: { metodo_pago: 'EFECTIVO', pago_con: 10000, descuento: 1000, propina: 500 } });
  assert.strictEqual(r.status, 200, 'cobro con descuento y propina');
  assert.strictEqual(r.data.subtotal, 7000, 'subtotal');
  assert.strictEqual(r.data.total, 6000, 'total con descuento');
  assert.strictEqual(r.data.propina, 500, 'propina registrada');
  assert.strictEqual(r.data.cambio, 3500, 'cambio = pago - (total + propina)');
  const ventaId2 = r.data.venta_id;

  // 20d) Descuento mayor al subtotal se rechaza
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, body: { numero: mesaNumero + 2 } });
  const mesaId3 = r.data.id;
  await pedir(`/api/mesas/${mesaId3}/abrir`, { method: 'POST', cookie: admin });
  r = await pedir(`/api/mesas/${mesaId3}/cuenta`, { cookie: admin });
  const cuentaId3 = r.data.cuenta.id;
  await pedir(`/api/cuentas/${cuentaId3}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodId, cantidad: 1 } });
  r = await pedir(`/api/cuentas/${cuentaId3}/cobrar`, { method: 'POST', cookie: admin, body: { metodo_pago: 'EFECTIVO', pago_con: 10000, descuento: 999999 } });
  assert.strictEqual(r.status, 400, 'descuento mayor al subtotal rechazado');

  // 20e) Detalle de venta (Fase 2 - punto B)
  r = await pedir(`/api/ventas/${ventaId2}`, { cookie: admin });
  assert.strictEqual(r.status, 200, 'detalle de venta');
  assert.strictEqual(r.data.items.length, 1, 'la venta tiene 1 item');
  assert.strictEqual(r.data.subtotal, 7000, 'subtotal del detalle');
  assert.strictEqual(r.data.venta.total, 6000, 'total del detalle');
  assert.strictEqual(r.data.venta.propina, 500, 'propina del detalle');

  // 20f) Anulación por producto (Fase 2 - punto C)
  // Venta de prueba con dos líneas del mismo producto
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, body: { numero: mesaNumero + 3 } });
  const mesaId4 = r.data.id;
  await pedir(`/api/mesas/${mesaId4}/abrir`, { method: 'POST', cookie: admin });
  r = await pedir(`/api/mesas/${mesaId4}/cuenta`, { cookie: admin });
  const cuentaId4 = r.data.cuenta.id;
  await pedir(`/api/cuentas/${cuentaId4}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodId, cantidad: 1 } });
  await pedir(`/api/cuentas/${cuentaId4}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodId, cantidad: 1 } });
  r = await pedir(`/api/productos`, { cookie: admin });
  const stockAntes = r.data.find((p) => p.id === prodId).stock_actual;
  r = await pedir(`/api/cuentas/${cuentaId4}/cobrar`, { method: 'POST', cookie: admin, body: { metodo_pago: 'EFECTIVO', pago_con: 7000 } });
  const ventaId3 = r.data.venta_id;
  assert.strictEqual(r.data.total, 7000, 'venta de dos líneas');
  r = await pedir(`/api/ventas/${ventaId3}`, { cookie: admin });
  const itemAnular = r.data.items[0].id;

  // El cajero no puede anular por producto
  r = await pedir(`/api/ventas/${ventaId3}/items/${itemAnular}/anular`, { method: 'POST', cookie: cajero, body: { motivo: 'prueba' } });
  assert.strictEqual(r.status, 403, 'el cajero no anula por producto');

  r = await pedir(`/api/ventas/${ventaId3}/items/${itemAnular}/anular`, { method: 'POST', cookie: admin, body: { motivo: 'Producto dañado' } });
  assert.strictEqual(r.status, 200, 'propietario anula un producto');
  assert.strictEqual(r.data.total, 3500, 'total recalculado tras anular un producto');
  r = await pedir(`/api/ventas/${ventaId3}`, { cookie: admin });
  assert.strictEqual(r.data.venta.estado, 'PAGADA', 'la venta sigue activa con un item');
  assert.strictEqual(r.data.subtotal, 3500, 'subtotal del detalle tras anular');
  r = await pedir('/api/productos', { cookie: admin });
  assert.strictEqual(r.data.find((p) => p.id === prodId).stock_actual, stockAntes + 1, 'stock devuelto al anular el producto');

  // 20g) Caja: desglose por método y efectivo esperado (Fase 2 - punto A)
  r = await pedir('/api/caja/resumen', { cookie: admin });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.data.por_metodo), 'resumen con desglose por método');
  assert.ok(typeof r.data.efectivo_esperado === 'number', 'resumen con efectivo esperado');
  assert.ok(r.data.ventas_efectivo <= r.data.ventas_total, 'el efectivo no supera el total');

  // 20h) Reportes (Fase 2 - punto E)
  r = await pedir('/api/reportes', { cookie: admin });
  assert.strictEqual(r.status, 200, 'reportes para propietario');
  assert.ok(r.data.resumen && Array.isArray(r.data.por_metodo), 'reportes con resumen y métodos');
  assert.ok(Array.isArray(r.data.top_productos), 'reportes con productos');
  r = await pedir('/api/reportes', { cookie: cajero });
  assert.strictEqual(r.status, 403, 'el cajero no ve reportes');

  // ===== Fase 3 - Fase C (Facturación) =====

  // 20i) Producto aislado para probar el stock con las cuentas
  r = await pedir('/api/productos', { method: 'POST', cookie: admin, body: {
    nombre: 'FaseC ' + sufijo, categoria_id: catId, precio_compra: 1000, precio_venta: 2000, stock_actual: 20, stock_minimo: 2,
  } });
  assert.strictEqual(r.status, 200, 'crear producto Fase C');
  const prodC = r.data.id;

  // 20j) Cuenta sin mesa (mostrador): se crea y queda pendiente
  r = await pedir('/api/cuentas', { method: 'POST', cookie: admin, body: {} });
  assert.strictEqual(r.status, 200, 'abrir cuenta de mostrador');
  const cuentaC = r.data.cuenta_id;
  r = await pedir('/api/cuentas?estado=ABIERTA', { cookie: admin });
  const pendienteC = r.data.find((c) => c.id === cuentaC);
  assert.ok(pendienteC && pendienteC.tipo === 'MOSTRADOR', 'la cuenta de mostrador queda pendiente');

  // 20k) Agregar producto a la cuenta: el stock baja al agregar
  r = await pedir(`/api/cuentas/${cuentaC}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodC, cantidad: 2 } });
  assert.strictEqual(r.status, 200, 'agregar a cuenta de mostrador');
  r = await pedir('/api/productos', { cookie: admin });
  assert.strictEqual(r.data.find((p) => p.id === prodC).stock_actual, 18, 'stock baja al agregar al mostrador');

  // 20l) Ajustar cantidad con PUT y luego quitarla con cantidad 0
  r = await pedir(`/api/cuentas/${cuentaC}`, { cookie: admin });
  const itemC = r.data.items[0].id;
  r = await pedir(`/api/cuentas/${cuentaC}/items/${itemC}`, { method: 'PUT', cookie: admin, body: { cantidad: 3 } });
  assert.strictEqual(r.status, 200, 'ajustar cantidad del item');
  assert.strictEqual(r.data.subtotal, 6000, 'subtotal recalculado');
  r = await pedir('/api/productos', { cookie: admin });
  assert.strictEqual(r.data.find((p) => p.id === prodC).stock_actual, 17, 'stock baja al subir la cantidad');
  r = await pedir(`/api/cuentas/${cuentaC}/items/${itemC}`, { method: 'PUT', cookie: admin, body: { cantidad: 0 } });
  assert.strictEqual(r.status, 200, 'quitar item con cantidad 0');
  r = await pedir('/api/productos', { cookie: admin });
  assert.strictEqual(r.data.find((p) => p.id === prodC).stock_actual, 20, 'stock devuelto al quitar el item');

  // 20m) Cancelar cuenta abierta: devuelve el stock y la quita de pendientes
  await pedir(`/api/cuentas/${cuentaC}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodC, cantidad: 5 } });
  r = await pedir(`/api/cuentas/${cuentaC}`, { method: 'DELETE', cookie: admin });
  assert.strictEqual(r.status, 200, 'cancelar cuenta abierta');
  r = await pedir('/api/productos', { cookie: admin });
  assert.strictEqual(r.data.find((p) => p.id === prodC).stock_actual, 20, 'stock devuelto al cancelar la cuenta');
  r = await pedir('/api/cuentas?estado=ABIERTA', { cookie: admin });
  assert.ok(!r.data.some((c) => c.id === cuentaC), 'la cuenta cancelada ya no está pendiente');

  // 20n) Venta rápida (cobro directo)
  r = await pedir('/api/cuentas/rapida', { method: 'POST', cookie: admin, body: {
    items: [{ producto_id: prodC, cantidad: 3 }], metodo_pago: 'EFECTIVO', pago_con: 7000,
  } });
  assert.strictEqual(r.status, 200, 'venta rápida');
  assert.strictEqual(r.data.total, 6000, 'total de la venta rápida');
  assert.strictEqual(r.data.cambio, 1000, 'cambio de la venta rápida');
  const ventaRapida = r.data.venta_id;
  r = await pedir('/api/productos', { cookie: admin });
  assert.strictEqual(r.data.find((p) => p.id === prodC).stock_actual, 17, 'stock baja en la venta rápida');
  r = await pedir('/api/ventas', { cookie: admin });
  assert.ok(r.data.some((v) => v.id === ventaRapida && v.cuenta_tipo === 'MOSTRADOR'), 'la venta rápida figura como mostrador');
  r = await pedir('/api/cuentas/rapida', { method: 'POST', cookie: admin, body: {
    items: [{ producto_id: prodC, cantidad: 1 }], metodo_pago: 'EFECTIVO', pago_con: 100000, descuento: 999999,
  } });
  assert.strictEqual(r.status, 400, 'descuento mayor al subtotal rechazado en venta rápida');

  // 20o) Cuenta sin mesa con nombre de cliente (opcional)
  r = await pedir('/api/cuentas', { method: 'POST', cookie: admin, body: { cliente: 'Cliente Fase C' } });
  const cuentaCli = r.data.cuenta_id;
  r = await pedir(`/api/cuentas/${cuentaCli}`, { cookie: admin });
  assert.strictEqual(r.data.cuenta.cliente, 'Cliente Fase C', 'cliente opcional guardado');
  await pedir(`/api/cuentas/${cuentaCli}`, { method: 'DELETE', cookie: admin });

  // 20o2) Nombre de mesa (Fase F): "Mesa #" pasa a "Mesa <cliente>" y vuelve al cerrar la cuenta
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, body: { numero: mesaNumero + 50 } });
  const mesaNom = r.data.id;
  // Abrir cuenta con cliente: el nombre de la mesa se refleja
  r = await pedir('/api/cuentas', { method: 'POST', cookie: admin, body: { mesa_id: mesaNom, cliente: 'Juan' } });
  const cuentaNom = r.data.cuenta_id;
  r = await pedir('/api/mesas', { cookie: admin });
  assert.strictEqual(r.data.find((m) => m.id === mesaNom).nombre_cliente, 'Juan', 'la mesa toma el nombre del cliente al abrir');
  r = await pedir('/api/cuentas?estado=ABIERTA', { cookie: admin });
  const cNom = r.data.find((c) => c.id === cuentaNom);
  assert.strictEqual(cNom.mesa_numero, mesaNumero + 50, 'la cuenta trae el número de mesa');
  assert.strictEqual(cNom.mesa_cliente, 'Juan', 'la cuenta trae el nombre de la mesa');
  // Editar la cuenta con otro cliente actualiza el nombre de la mesa
  await pedir(`/api/cuentas/${cuentaNom}`, { method: 'PUT', cookie: admin, body: { cliente: 'Pedro' } });
  r = await pedir('/api/mesas', { cookie: admin });
  assert.strictEqual(r.data.find((m) => m.id === mesaNom).nombre_cliente, 'Pedro', 'editar la cuenta cambia el nombre de la mesa');
  // Cobrar la cuenta: la mesa vuelve a su estado normal sin nombre
  await pedir(`/api/cuentas/${cuentaNom}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodC, cantidad: 1 } });
  r = await pedir(`/api/cuentas/${cuentaNom}/cobrar`, { method: 'POST', cookie: admin, body: { metodo_pago: 'EFECTIVO', pago_con: 5000 } });
  assert.strictEqual(r.status, 200, 'cobrar la cuenta con nombre');
  r = await pedir('/api/mesas', { cookie: admin });
  const mesaDespues = r.data.find((m) => m.id === mesaNom);
  assert.strictEqual(mesaDespues.estado, 'LIBRE', 'la mesa queda libre tras cobrar');
  assert.strictEqual(mesaDespues.nombre_cliente, null, 'la mesa pierde el nombre al cerrar la cuenta');

  // El nombre también se puede fijar desde el módulo Mesas (PUT /api/mesas/:id)
  r = await pedir(`/api/mesas/${mesaNom}`, { method: 'PUT', cookie: admin, body: { numero: mesaNumero + 50, nombre_cliente: 'Luis' } });
  assert.strictEqual(r.status, 200, 'editar el nombre de la mesa');
  r = await pedir('/api/mesas', { cookie: admin });
  assert.strictEqual(r.data.find((m) => m.id === mesaNom).nombre_cliente, 'Luis', 'el nombre se guarda desde el módulo Mesas');
  // Abrir sin cliente conserva el nombre; cancelar la cuenta lo limpia
  r = await pedir('/api/cuentas', { method: 'POST', cookie: admin, body: { mesa_id: mesaNom } });
  const cuentaNom2 = r.data.cuenta_id;
  r = await pedir('/api/cuentas?estado=ABIERTA', { cookie: admin });
  assert.strictEqual(r.data.find((c) => c.id === cuentaNom2).mesa_cliente, 'Luis', 'abrir sin cliente conserva el nombre de la mesa');
  await pedir(`/api/cuentas/${cuentaNom2}`, { method: 'DELETE', cookie: admin });
  r = await pedir('/api/mesas', { cookie: admin });
  assert.strictEqual(r.data.find((m) => m.id === mesaNom).nombre_cliente, null, 'cancelar la cuenta limpia el nombre de la mesa');

  // ===== Fase G (mejoras del propietario) =====

  // 20r) "Ver todas" en Ventas: paginación en orden ascendente
  r = await pedir('/api/ventas?todas=1&orden=asc&limite=1&offset=0', { cookie: admin });
  assert.strictEqual(r.status, 200, 'ventas "ver todas"');
  assert.ok(Array.isArray(r.data), '"ver todas" devuelve un arreglo');
  assert.ok(r.data.length <= 1, 'respeta el límite de la página');
  const primeraFecha = r.data[0] && r.data[0].fecha;
  r = await pedir('/api/ventas?todas=1&orden=asc&limite=1&offset=1', { cookie: admin });
  if (r.data.length === 1 && primeraFecha) {
    assert.ok(r.data[0].fecha >= primeraFecha, 'el orden ascendente avanza en el tiempo');
  }

  // 20s) Reportes: cada producto trae unidades e ingresos (alimenta el selector)
  r = await pedir('/api/reportes', { cookie: admin });
  assert.strictEqual(r.status, 200);
  if (r.data.top_productos.length > 0) {
    const tp = r.data.top_productos[0];
    assert.ok(typeof tp.cantidad === 'number', 'el producto trae unidades');
    assert.ok(typeof tp.total === 'number', 'el producto trae ingresos');
  }

  // 20t) Pasar los productos de "Visitante" (mostrador) a una mesa libre
  r = await pedir('/api/mesas', { method: 'POST', cookie: admin, body: { numero: mesaNumero + 60 } });
  const mesaG = r.data.id;
  r = await pedir('/api/cuentas', { method: 'POST', cookie: admin, body: {} });
  const cuentaG = r.data.cuenta_id;
  await pedir(`/api/cuentas/${cuentaG}/items`, { method: 'POST', cookie: admin, body: { producto_id: prodC, cantidad: 2 } });
  r = await pedir('/api/productos', { cookie: admin });
  const stockG = r.data.find((p) => p.id === prodC).stock_actual;
  // La misma cuenta cambia de destino (los productos no se tocan)
  r = await pedir(`/api/cuentas/${cuentaG}`, { method: 'PUT', cookie: admin, body: { mesa_id: mesaG } });
  assert.strictEqual(r.status, 200, 'pasar los productos del mostrador a la mesa');
  r = await pedir('/api/mesas', { cookie: admin });
  assert.strictEqual(r.data.find((m) => m.id === mesaG).estado, 'OCUPADA', 'la mesa queda ocupada');
  r = await pedir('/api/cuentas?estado=ABIERTA', { cookie: admin });
  const cG = r.data.find((c) => c.id === cuentaG);
  assert.strictEqual(cG.tipo, 'MESA', 'la cuenta pasa a tipo MESA');
  assert.strictEqual(cG.mesa_numero, mesaNumero + 60, 'la cuenta apunta a la mesa elegida');
  r = await pedir('/api/productos', { cookie: admin });
  assert.strictEqual(r.data.find((p) => p.id === prodC).stock_actual, stockG, 'mover a la mesa no vuelve a descontar stock');
  // No se permite abrir otra cuenta en la mesa ya ocupada
  r = await pedir('/api/cuentas', { method: 'POST', cookie: admin, body: { mesa_id: mesaG } });
  assert.strictEqual(r.status, 409, 'no se duplica la cuenta en una mesa ocupada');
  // Cerramos la cuenta para no dejar pendientes
  await pedir(`/api/cuentas/${cuentaG}/cobrar`, { method: 'POST', cookie: admin, body: { metodo_pago: 'EFECTIVO', pago_con: 10000 } });

  // 20u) Gestionar cuenta: el cajero no cambia usuario ni correo (solo el propietario)
  r = await pedir('/api/usuarios/perfil', { method: 'PUT', cookie: cajero, body: { nombre: 'Cajero Test', apodo: 'Cajerito', usuario: 'intruso', correo: 'intruso@x.com' } });
  assert.strictEqual(r.status, 200, 'el cajero guarda nombre y apodo');
  assert.strictEqual(r.data.usuario, 'cajero_test', 'el cajero no puede renombrar su usuario');
  assert.strictEqual(r.data.correo, null, 'el cajero no puede fijar su correo');
  r = await pedir('/api/usuarios', { cookie: admin });
  assert.ok(!r.data.some((u) => u.usuario === 'intruso'), 'no se creó un usuario "intruso"');

  // 20v) El propietario sí edita su propio usuario/correo, con validación
  r = await pedir('/api/usuarios/perfil', { method: 'PUT', cookie: admin, body: { nombre: 'Propietario', apodo: 'Admin', correo: 'admin@chamalu.test' } });
  assert.strictEqual(r.status, 200, 'el propietario guarda su cuenta');
  assert.strictEqual(r.data.correo, 'admin@chamalu.test', 'correo actualizado');
  r = await pedir('/api/usuarios/perfil', { method: 'PUT', cookie: admin, body: { nombre: 'Propietario', apodo: 'Admin', correo: 'no-es-correo' } });
  assert.strictEqual(r.status, 400, 'correo inválido rechazado');
  r = await pedir('/api/usuarios/perfil', { method: 'PUT', cookie: admin, body: { nombre: 'Propietario', apodo: 'Admin', usuario: 'ab' } });
  assert.strictEqual(r.status, 400, 'usuario demasiado corto rechazado');

  // ===== Fase 3 - Fase D (Inicio/dashboard) =====

  // 20p) El propietario recibe hoy/ayer, ganancia, pérdida y pendientes
  r = await pedir('/api/dashboard/resumen', { cookie: admin });
  assert.strictEqual(r.status, 200, 'resumen de Inicio (propietario)');
  assert.ok(r.data.hoy && r.data.ayer, 'resumen con día de hoy y de ayer');
  assert.ok(typeof r.data.hoy.ventas === 'number', 'ventas de hoy');
  assert.ok(typeof r.data.hoy.ganancia === 'number', 'el propietario recibe ganancia');
  assert.ok(r.data.hoy.ganancia <= r.data.hoy.ventas, 'la ganancia no supera las ventas');
  assert.ok(typeof r.data.hoy.perdida === 'number', 'el propietario recibe pérdida');
  assert.ok(r.data.pendientes && typeof r.data.pendientes.total === 'number', 'cuentas pendientes por cobrar');

  // 20q) El cajero recibe el resumen pero sin ganancia ni pérdida
  r = await pedir('/api/dashboard/resumen', { cookie: cajero });
  assert.strictEqual(r.status, 200, 'resumen de Inicio (cajero)');
  assert.ok(typeof r.data.hoy.ventas === 'number', 'el cajero ve las ventas');
  assert.strictEqual(r.data.hoy.ganancia, undefined, 'el cajero no recibe ganancia');
  assert.strictEqual(r.data.hoy.perdida, undefined, 'el cajero no recibe pérdida');

  // 21) Cerrar caja
  r = await pedir('/api/caja/cierre', { method: 'POST', cookie: admin, body: { monto_declarado: 145000 } });
  assert.strictEqual(r.status, 200, 'cierre de caja');
  assert.ok(typeof r.data.diferencia === 'number', 'se calcula la diferencia');

  // 22) Copia de seguridad: el propietario sí, el cajero no
  r = await pedir('/api/configuracion/backups', { method: 'POST', cookie: admin });
  assert.strictEqual(r.status, 200, 'crear copia de seguridad');
  const nombreBackup = r.data.nombre;
  r = await pedir('/api/configuracion/backups', { cookie: admin });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.some((b) => b.nombre === nombreBackup), 'la copia aparece en la lista');

  r = await pedir('/api/configuracion/backups', { method: 'POST', cookie: cajero });
  assert.strictEqual(r.status, 403, 'el cajero no crea copias');

  // ===== Fase 3 - Fase A =====

  // 23) Un propietario no se puede desactivar
  r = await pedir('/api/usuarios', { cookie: admin });
  const adminFila = r.data.find((u) => u.usuario === 'admin');
  const adminId = adminFila.id;
  // 22b) Fase E3: el estado "en línea" se calcula según la última actividad
  assert.strictEqual(adminFila.en_linea, 1, 'el admin conectado aparece en línea');
  assert.ok(typeof adminFila.minutos_inactivo === 'number', 'minutos_inactivo es numérico');
  r = await pedir(`/api/usuarios/${adminId}`, { method: 'PUT', cookie: admin, body: { activo: false } });
  assert.strictEqual(r.status, 400, 'no se puede desactivar a un propietario');

  // 23b) Alertas con filtro: todas / leídas / no leídas
  r = await pedir('/api/alertas?filtro=todas', { cookie: admin });
  assert.strictEqual(r.status, 200, 'alertas (todas)');
  assert.ok(Array.isArray(r.data), 'alertas devuelve una lista');
  if (r.data.length > 0) {
    const alertaId = r.data[0].id;
    await pedir(`/api/alertas/${alertaId}/no-leer`, { method: 'POST', cookie: admin });
    r = await pedir('/api/alertas?filtro=no-leidas', { cookie: admin });
    assert.ok(r.data.some((a) => a.id === alertaId), 'la alerta aparece como no leída');
    await pedir(`/api/alertas/${alertaId}/leer`, { method: 'POST', cookie: admin });
    r = await pedir('/api/alertas?filtro=leidas', { cookie: admin });
    assert.ok(r.data.some((a) => a.id === alertaId), 'la alerta aparece como leída');
  }

  // 23c) No se puede eliminar una mesa con cuentas asociadas
  r = await pedir(`/api/mesas/${mesaId}`, { method: 'DELETE', cookie: admin });
  assert.strictEqual(r.status, 400, 'mesa con historial no se elimina');

  // 23d) Se puede eliminar un cajero sin historial obligatorio (al final, porque cierra su sesión)
  r = await pedir('/api/usuarios', { cookie: admin });
  const cajeroId = r.data.find((u) => u.usuario === 'cajero_test').id;
  r = await pedir(`/api/usuarios/${cajeroId}`, { method: 'DELETE', cookie: admin });
  assert.strictEqual(r.status, 200, 'se elimina un cajero sin historial');
});
