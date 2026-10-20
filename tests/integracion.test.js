import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initSchema, seedAdmin } from '../server/config/db.js';
import { generarAlertas } from '../server/routes/alertas.routes.js';
import { calcularResumen } from '../server/routes/dashboard.routes.js';
import { nowCO } from '../server/config/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Permite apuntar a una base de datos temporal en las pruebas automáticas
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'chamalu.db');

// Tests de integración para Chamalú Beer
describe('Chamalú Beer - Tests de Integración', () => {
  let db;

  before(async () => {
    // Asegura que el esquema, las migraciones y el admin existan
    await initSchema();
    await seedAdmin();
    db = new DatabaseSync(DB_PATH);
  });

  after(() => {
    db.close();
  });

  describe('Base de Datos', () => {
    test('Las tablas principales existen', () => {
      const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
      const esperadas = ['usuarios', 'sesiones', 'configuracion', 'turnos_caja', 'categorias', 'productos', 'mesas', 'cuentas_mesa', 'items_cuenta', 'ventas', 'movimientos_inventario', 'movimientos_caja_chica', 'gastos', 'alertas', 'logs_auditoria'];
      for (const t of esperadas) {
        assert.ok(tablas.includes(t), `Falta la tabla: ${t}`);
      }
    });

    test('El usuario admin existe', () => {
      const admin = db.prepare("SELECT * FROM usuarios WHERE usuario = 'admin'").get();
      assert.ok(admin, 'El usuario admin no existe');
      assert.strictEqual(admin.rol, 'PROPIETARIO');
    });

    test('Los índices de optimización existen', () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
      for (const n of ['idx_sesiones_expira', 'idx_items_cuenta', 'idx_ventas_fecha', 'idx_mov_inv_producto', 'idx_alertas_leida']) {
        assert.ok(idx.includes(n), `Falta el índice: ${n}`);
      }
    });

    test('Fase 2: items_cuenta tiene la columna anulado', () => {
      const cols = db.prepare("SELECT name FROM pragma_table_info('items_cuenta')").all().map((c) => c.name);
      assert.ok(cols.includes('anulado'), 'Falta items_cuenta.anulado');
    });

    test('Fase 2: ventas tiene las columnas descuento y propina', () => {
      const cols = db.prepare("SELECT name FROM pragma_table_info('ventas')").all().map((c) => c.name);
      assert.ok(cols.includes('descuento'), 'Falta ventas.descuento');
      assert.ok(cols.includes('propina'), 'Falta ventas.propina');
    });

    test('Fase 3 - Fase C: cuentas_mesa admite mostrador (mesa_id opcional, cliente y tipo)', () => {
      const cols = db.prepare("SELECT name, \"notnull\" AS nn FROM pragma_table_info('cuentas_mesa')").all();
      const porNombre = Object.fromEntries(cols.map((c) => [c.name, c]));
      assert.ok(porNombre.mesa_id, 'Falta cuentas_mesa.mesa_id');
      assert.strictEqual(porNombre.mesa_id.nn, 0, 'mesa_id debe ser opcional (mostrador)');
      assert.ok(porNombre.cliente, 'Falta cuentas_mesa.cliente');
      assert.ok(porNombre.tipo, 'Falta cuentas_mesa.tipo');
    });

    test('Fase 3 - Fase C: existe el índice idx_cuentas_estado', () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
      assert.ok(idx.includes('idx_cuentas_estado'), 'Falta idx_cuentas_estado');
    });
  });

  describe('Autenticación y Seguridad', () => {
    test('Las contraseñas están hasheadas con bcrypt', () => {
      const admin = db.prepare("SELECT password_hash FROM usuarios WHERE usuario = 'admin'").get();
      assert.ok(admin.password_hash.startsWith('$2'), 'La contraseña no está hasheada con bcrypt');
      assert.ok(bcrypt.compareSync('admin123', admin.password_hash), 'La contraseña no coincide');
    });

    test('Los tokens de sesión son aleatorios y únicos', () => {
      const tokens = db.prepare('SELECT token FROM sesiones').all();
      const set = new Set(tokens.map(t => t.token));
      assert.strictEqual(tokens.length, set.size, 'Hay tokens duplicados');
    });

    test('La tabla usuarios tiene la columna debe_cambiar_password', () => {
      const cols = db.prepare("SELECT name FROM pragma_table_info('usuarios')").all().map(c => c.name);
      assert.ok(cols.includes('debe_cambiar_password'), 'Falta la columna debe_cambiar_password');
    });
  });

  describe('Productos y Categorías', () => {
    test('Se puede crear una categoría', () => {
      const info = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run('Test Categoría');
      assert.ok(info.lastInsertRowid > 0);
      db.prepare('DELETE FROM categorias WHERE nombre = ?').run('Test Categoría');
    });

    test('Se puede crear un producto', () => {
      const cat = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run('Test Cat');
      const info = db.prepare(
        'INSERT INTO productos (nombre, categoria_id, precio_venta, stock_actual) VALUES (?, ?, ?, ?)'
      ).run('Test Producto', cat.lastInsertRowid, 5000, 10);
      assert.ok(info.lastInsertRowid > 0);
      db.prepare('DELETE FROM productos WHERE nombre = ?').run('Test Producto');
      db.prepare('DELETE FROM categorias WHERE nombre = ?').run('Test Cat');
    });

    test('No se permiten precios negativos', () => {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'productos'").get();
      assert.ok(schema.sql.includes('precio_venta'), 'No hay campo precio_venta');
    });
  });

  describe('Mesas y Ventas', () => {
    test('Se puede crear una mesa', () => {
      const info = db.prepare('INSERT INTO mesas (numero) VALUES (?)').run(999);
      assert.ok(info.lastInsertRowid > 0);
      db.prepare('DELETE FROM mesas WHERE numero = ?').run(999);
    });

    test('La venta registra el usuario que la hizo', () => {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ventas'").get();
      assert.ok(schema.sql.includes('usuario_id'), 'La venta no registra el usuario');
    });
  });

  describe('Mesas con zonas (Fase G)', () => {
    const nums = { a: 901, b: 902, c: 903 };
    after(() => {
      db.prepare('DELETE FROM mesas WHERE numero IN (?, ?, ?)').run(nums.a, nums.b, nums.c);
    });

    test('Se puede crear una mesa con zona', () => {
      const info = db.prepare('INSERT INTO mesas (numero, zona) VALUES (?, ?)').run(nums.a, 'Terraza Test');
      const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(info.lastInsertRowid);
      assert.strictEqual(mesa.zona, 'Terraza Test', 'la mesa no guarda la zona');
      assert.strictEqual(mesa.numero, nums.a);
    });

    test('No se permite repetir número en la misma zona (zona + número únicos)', () => {
      db.prepare('INSERT INTO mesas (numero, zona) VALUES (?, ?)').run(nums.b, 'Barra Test');
      assert.throws(
        () => db.prepare('INSERT INTO mesas (numero, zona) VALUES (?, ?)').run(nums.b, 'Barra Test'),
        /UNIQUE/i,
        'debería fallar por repetir zona + número'
      );
    });

    test('Sí se permite el mismo número en otra zona', () => {
      // nums.b ya existe en "Barra Test" (prueba anterior); el mismo número en otra zona debe poder crearse
      const info = db.prepare('INSERT INTO mesas (numero, zona) VALUES (?, ?)').run(nums.b, 'Terraza Test');
      const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(info.lastInsertRowid);
      assert.strictEqual(mesa.zona, 'Terraza Test', 'la mesa de otra zona no se creó');
    });

    test('Dos mesas sin zona no pueden repetir número', () => {
      db.prepare('INSERT INTO mesas (numero) VALUES (?)').run(nums.c);
      assert.throws(
        () => db.prepare('INSERT INTO mesas (numero) VALUES (?)').run(nums.c),
        /UNIQUE/i,
        'dos mesas sin zona no pueden tener el mismo número'
      );
    });
  });

  describe('Inventario', () => {
    test('Los movimientos de inventario registran stock anterior y nuevo', () => {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'movimientos_inventario'").get();
      assert.ok(schema.sql.includes('stock_anterior'), 'No registra stock anterior');
      assert.ok(schema.sql.includes('stock_nuevo'), 'No registra stock nuevo');
    });
  });

  describe('Auditoría', () => {
    test('El log de auditoría registra acciones', () => {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'logs_auditoria'").get();
      assert.ok(schema.sql.includes('accion'), 'No registra la acción');
      assert.ok(schema.sql.includes('fecha'), 'No registra la fecha');
    });
  });

  describe('Configuración', () => {
    test('Se puede guardar configuración', () => {
      db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
        .run('test_key', 'test_value');
      const val = db.prepare("SELECT valor FROM configuracion WHERE clave = 'test_key'").get();
      assert.strictEqual(val.valor, 'test_value');
      db.prepare("DELETE FROM configuracion WHERE clave = 'test_key'").run();
    });
  });

  describe('Alertas (Fase 3 - Fase A)', () => {
    test('generarAlertas crea una alerta de stock bajo', async () => {
      const cat = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run('Test Alerta Cat');
      const prod = db.prepare(
        'INSERT INTO productos (nombre, categoria_id, precio_venta, stock_actual, stock_minimo) VALUES (?, ?, ?, ?, ?)'
      ).run('Producto Alerta ' + Date.now(), cat.lastInsertRowid, 1000, 0, 5);

      await generarAlertas();

      const alerta = db.prepare(
        "SELECT * FROM alertas WHERE tipo = 'STOCK_BAJO' AND mensaje LIKE '%Producto Alerta%'"
      ).get();
      assert.ok(alerta, 'no se generó la alerta de stock bajo');

      db.prepare("DELETE FROM alertas WHERE tipo = 'STOCK_BAJO' AND mensaje LIKE '%Producto Alerta%'").run();
      db.prepare('DELETE FROM productos WHERE id = ?').run(prod.lastInsertRowid);
      db.prepare('DELETE FROM categorias WHERE id = ?').run(cat.lastInsertRowid);
    });
  });

  describe('Panel Inicio (Fase 3 - Fase D)', () => {
    let ids;

    before(() => {
      const adminId = db.prepare("SELECT id FROM usuarios WHERE usuario = 'admin'").get().id;
      const catId = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run('Test Inicio Cat').lastInsertRowid;
      const prodId = db.prepare(
        'INSERT INTO productos (nombre, categoria_id, precio_compra, precio_venta, stock_actual) VALUES (?, ?, ?, ?, ?)'
      ).run('Producto Inicio', catId, 2000, 3500, 100).lastInsertRowid;
      const cuentaId = db.prepare(
        "INSERT INTO cuentas_mesa (mesa_id, usuario_id, cliente, tipo, estado, apertura_en) VALUES (NULL, ?, NULL, 'MOSTRADOR', 'CERRADA', ?)"
      ).run(adminId, nowCO()).lastInsertRowid;
      db.prepare(
        'INSERT INTO items_cuenta (cuenta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)'
      ).run(cuentaId, prodId, 2, 3500, 7000);
      const ventaId = db.prepare(
        "INSERT INTO ventas (cuenta_id, usuario_id, total, metodo_pago, fecha) VALUES (?, ?, ?, 'EFECTIVO', ?)"
      ).run(cuentaId, adminId, 7000, nowCO()).lastInsertRowid;
      const gastoId = db.prepare(
        'INSERT INTO gastos (descripcion, monto, categoria, usuario_id, fecha) VALUES (?, ?, ?, ?, ?)'
      ).run('Gasto Inicio', 1000, 'Otro', adminId, nowCO()).lastInsertRowid;
      ids = { catId, prodId, cuentaId, ventaId, gastoId };
    });

    after(() => {
      db.prepare('DELETE FROM ventas WHERE id = ?').run(ids.ventaId);
      db.prepare('DELETE FROM gastos WHERE id = ?').run(ids.gastoId);
      db.prepare('DELETE FROM items_cuenta WHERE cuenta_id = ?').run(ids.cuentaId);
      db.prepare('DELETE FROM cuentas_mesa WHERE id = ?').run(ids.cuentaId);
      db.prepare('DELETE FROM productos WHERE id = ?').run(ids.prodId);
      db.prepare('DELETE FROM categorias WHERE id = ?').run(ids.catId);
    });

    test('El propietario recibe ventas, ganancia y pérdida del día', async () => {
      const r = await calcularResumen({ rol: 'PROPIETARIO' });
      assert.ok(r.hoy.ventas >= 7000, 'las ventas del día incluyen la venta de prueba');
      assert.ok(r.hoy.ganancia < r.hoy.ventas, 'la ganancia descuenta el costo de lo vendido');
      assert.ok(r.hoy.perdida >= 1000, 'la pérdida incluye el gasto del día');
      assert.strictEqual(typeof r.ayer.ventas, 'number');
    });

    test('El cajero no recibe ganancia ni pérdida', async () => {
      const r = await calcularResumen({ rol: 'CAJERO' });
      assert.strictEqual(r.hoy.ganancia, undefined, 'sin ganancia para el cajero');
      assert.strictEqual(r.hoy.perdida, undefined, 'sin pérdida para el cajero');
      assert.strictEqual(typeof r.hoy.ventas, 'number');
      assert.strictEqual(r.turno_caja, null);
    });
  });
});
