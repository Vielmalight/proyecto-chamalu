import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { nowCO } from './constants.js';
import { ejecutarMigraciones } from './migraciones.js';

// ---------------------------------------------------------------------------
// Adaptador dual de base de datos:
//  - Local (desarrollo y pruebas): SQLite en disco con node:sqlite (síncrono).
//  - Remoto (despliegue en la nube, ej. Vercel + Turso): libSQL con TURSO_URL.
// La API es idéntica en ambos modos: prepare().get/all/run, exec() y transaccion().
// En local los métodos devuelven valores y en remoto promesas; usar `await`
// funciona correctamente con los dos (await sobre un valor no prometido lo devuelve igual).
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
// Por defecto: data/dev.db en desarrollo, data/chamalu.db en producción
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, isProd ? 'chamalu.db' : 'dev.db');

// Convierte una fila remota en un objeto plano (igual que node:sqlite devuelve)
function filaPlana(fila) {
  return Object.assign({}, fila);
}

// Normaliza el resultado de run() para que ambos modos devuelvan
// { changes, lastInsertRowid } (node:sqlite lo trae así; libSQL trae rowsAffected)
function normalizarRun(resultado) {
  if (resultado && typeof resultado === 'object' && 'changes' in resultado) return resultado;
  return {
    changes: resultado?.rowsAffected ?? 0,
    lastInsertRowid: Number(resultado?.lastInsertRowid ?? 0),
  };
}

// ---------- Modo local: SQLite en disco (sin cambios de comportamiento) ----------
function crearModoLocal() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sq = new DatabaseSync(DB_PATH);
  sq.exec('PRAGMA journal_mode = WAL;');
  sq.exec('PRAGMA foreign_keys = ON;');
  sq.exec('PRAGMA busy_timeout = 5000;');

  const adaptador = {
    modo: 'local',
    prepare(sql) {
      const stmt = sq.prepare(sql);
      return {
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
        run: (...args) => normalizarRun(stmt.run(...args)),
      };
    },
    exec(sql) {
      sq.exec(sql);
    },
    // Solo lo usan las pruebas; en remoto no hay conexión que cerrar
    close() {
      sq.close();
    },
    async transaccion(fn, { inmediata = false } = {}) {
      sq.exec(inmediata ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const r = await fn(adaptador);
        sq.exec('COMMIT');
        return r;
      } catch (err) {
        try { sq.exec('ROLLBACK'); } catch { /* sin transacción activa */ }
        throw err;
      }
    },
  };
  return adaptador;
}

// ---------- Modo remoto: Turso/libSQL sobre HTTP ----------
async function crearModoRemoto() {
  const { createClient } = await import('@libsql/client');
  const cliente = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
  });

  // Envuelve una función de ejecución en la interfaz get/all/run
  const envolver = (ejecutar) => ({
    async get(...args) {
      const r = await ejecutar(args);
      return r.rows.length ? filaPlana(r.rows[0]) : undefined;
    },
    async all(...args) {
      const r = await ejecutar(args);
      return r.rows.map(filaPlana);
    },
    async run(...args) {
      return normalizarRun(await ejecutar(args));
    },
  });

  const adaptador = {
    modo: 'remoto',
    prepare(sql) {
      return envolver((args) => cliente.execute({ sql, args }));
    },
    async exec(sql) {
      await cliente.executeMultiple(sql);
    },
    close() {
      /* no hay conexión local que cerrar (solo se usa en pruebas) */
    },
    async transaccion(fn, { inmediata = false } = {}) {
      // libSQL solo distingue 'read'/'write'; 'write' equivale a BEGIN IMMEDIATE
      const tx = await cliente.transaction('write');
      const adaptadorTx = {
        prepare: (sql) => envolver((args) => tx.execute({ sql, args })),
        exec: (sql) => tx.executeMultiple(sql),
      };
      try {
        const r = await fn(adaptadorTx);
        await tx.commit();
        return r;
      } catch (err) {
        try { await tx.rollback(); } catch { /* sin transacción activa */ }
        throw err;
      }
    },
  };
  return adaptador;
}

export const db = process.env.TURSO_URL ? await crearModoRemoto() : crearModoLocal();

// Ejecutar migraciones numeradas antes de initSchema
try {
  await ejecutarMigraciones(db);
} catch (e) {
  console.error('Error ejecutando migraciones:', e.message);
}

export async function initSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      apodo TEXT,
      correo TEXT UNIQUE,
      usuario TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('PROPIETARIO','CAJERO')),
      activo INTEGER NOT NULL DEFAULT 1,
      debe_cambiar_password INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sesiones (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en TEXT NOT NULL,
      ultima_actividad TEXT NOT NULL,
      expira_en TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS configuracion (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE IF NOT EXISTS turnos_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      monto_apertura INTEGER NOT NULL DEFAULT 0,
      monto_caja_chica INTEGER NOT NULL DEFAULT 0,
      monto_cierre_declarado INTEGER,
      diferencia INTEGER,
      fecha_apertura TEXT NOT NULL,
      fecha_cierre TEXT,
      estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK(estado IN ('ABIERTA','CERRADA'))
    );

    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      descripcion TEXT,
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_barras TEXT,
      nombre TEXT NOT NULL,
      categoria_id INTEGER REFERENCES categorias(id),
      imagen_url TEXT,
      precio_compra INTEGER NOT NULL DEFAULT 0,
      precio_venta INTEGER NOT NULL,
      stock_actual INTEGER NOT NULL DEFAULT 0,
      stock_minimo INTEGER NOT NULL DEFAULT 0,
      unidad_medida TEXT NOT NULL DEFAULT 'unidad',
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS mesas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero INTEGER NOT NULL,
      zona TEXT NOT NULL DEFAULT '',
      nombre_cliente TEXT,
      estado TEXT NOT NULL DEFAULT 'LIBRE' CHECK(estado IN ('LIBRE','OCUPADA','CERRADA')),
      UNIQUE(zona, numero)
    );

    CREATE TABLE IF NOT EXISTS cuentas_mesa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mesa_id INTEGER REFERENCES mesas(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      cliente TEXT,
      tipo TEXT NOT NULL DEFAULT 'MESA' CHECK(tipo IN ('MESA','MOSTRADOR')),
      estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK(estado IN ('ABIERTA','CERRADA')),
      apertura_en TEXT NOT NULL,
      cierre_en TEXT
    );

    CREATE TABLE IF NOT EXISTS items_cuenta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_id INTEGER NOT NULL REFERENCES cuentas_mesa(id),
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      cantidad INTEGER NOT NULL,
      precio_unitario INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      anulado INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_id INTEGER REFERENCES cuentas_mesa(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      total INTEGER NOT NULL,
      metodo_pago TEXT NOT NULL,
      pago_con INTEGER,
      cambio INTEGER,
      descuento INTEGER NOT NULL DEFAULT 0,
      propina INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'PAGADA' CHECK(estado IN ('PAGADA','ANULADA')),
      motivo_anulacion TEXT,
      fecha TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movimientos_inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA','SALIDA','AJUSTE')),
      cantidad INTEGER NOT NULL,
      stock_anterior INTEGER NOT NULL,
      stock_nuevo INTEGER NOT NULL,
      motivo TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      fecha TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movimientos_caja_chica (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_id INTEGER NOT NULL REFERENCES turnos_caja(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA','SALIDA')),
      monto INTEGER NOT NULL,
      descripcion TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      fecha TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descripcion TEXT NOT NULL,
      monto INTEGER NOT NULL,
      categoria TEXT NOT NULL,
      usuario_id INTEGER REFERENCES usuarios(id),
      fecha TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alertas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      leida INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs_auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      accion TEXT NOT NULL,
      detalle TEXT,
      ip TEXT,
      fecha TEXT NOT NULL
    );

    -- Índices para acelerar las consultas más frecuentes
    CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira_en);
    CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
    CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo);
    CREATE INDEX IF NOT EXISTS idx_cuentas_mesa_mesa ON cuentas_mesa(mesa_id, estado);
    CREATE INDEX IF NOT EXISTS idx_items_cuenta ON items_cuenta(cuenta_id);
    CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);
    CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);
    CREATE INDEX IF NOT EXISTS idx_ventas_usuario ON ventas(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_mov_inv_producto ON movimientos_inventario(producto_id, fecha);
    CREATE INDEX IF NOT EXISTS idx_mov_chica_turno ON movimientos_caja_chica(turno_id);
    CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);
    CREATE INDEX IF NOT EXISTS idx_logs_fecha ON logs_auditoria(fecha);
    CREATE INDEX IF NOT EXISTS idx_logs_usuario ON logs_auditoria(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_alertas_leida ON alertas(leida);
  `);

  // Migración: agrega columnas nuevas a bases de datos ya creadas
  await migrarColumnas();
  // Migración: cuentas sin mesa (facturación de mostrador) + cliente/tipo
  await migrarCuentasFacturacion();
  // Migración: zonas en las mesas (unicidad por zona + número)
  await migrarMesasZonas();
  // Migración: marcar productos con precio pendiente
  await migrarPrecioPendiente();
}

// Añade el flag precio_pendiente para marcar productos sin precio (regla productos.txt)
async function migrarPrecioPendiente() {
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('productos')").all()).map((c) => c.name);
  if (!cols.includes('precio_pendiente')) {
    await db.exec('ALTER TABLE productos ADD COLUMN precio_pendiente INTEGER NOT NULL DEFAULT 0');
    console.log('Migración aplicada: productos.precio_pendiente añadido.');
  }
}

// Añade columnas que falten en tablas existentes (bases creadas antes)
async function migrarColumnas() {
  const columnas = (await db.prepare("SELECT name FROM pragma_table_info('turnos_caja')").all()).map((c) => c.name);
  if (!columnas.includes('monto_cierre_declarado')) {
    await db.exec('ALTER TABLE turnos_caja ADD COLUMN monto_cierre_declarado INTEGER');
  }
  if (!columnas.includes('diferencia')) {
    await db.exec('ALTER TABLE turnos_caja ADD COLUMN diferencia INTEGER');
  }

  const colUsuarios = (await db.prepare("SELECT name FROM pragma_table_info('usuarios')").all()).map((c) => c.name);
  if (!colUsuarios.includes('debe_cambiar_password')) {
    await db.exec('ALTER TABLE usuarios ADD COLUMN debe_cambiar_password INTEGER NOT NULL DEFAULT 0');
  }

  const colItems = (await db.prepare("SELECT name FROM pragma_table_info('items_cuenta')").all()).map((c) => c.name);
  if (!colItems.includes('anulado')) {
    await db.exec('ALTER TABLE items_cuenta ADD COLUMN anulado INTEGER NOT NULL DEFAULT 0');
  }

  const colVentas = (await db.prepare("SELECT name FROM pragma_table_info('ventas')").all()).map((c) => c.name);
  if (!colVentas.includes('descuento')) {
    await db.exec('ALTER TABLE ventas ADD COLUMN descuento INTEGER NOT NULL DEFAULT 0');
  }
  if (!colVentas.includes('propina')) {
    await db.exec('ALTER TABLE ventas ADD COLUMN propina INTEGER NOT NULL DEFAULT 0');
  }
}

// Reconstruye cuentas_mesa para permitir cuentas SIN mesa (mesa_id opcional)
// y añade las columnas cliente y tipo. SQLite no permite quitar NOT NULL con ALTER,
// así que se recrea la tabla conservando los datos.
async function migrarCuentasFacturacion() {
  const cols = await db.prepare('SELECT name, "notnull" AS nn FROM pragma_table_info(\'cuentas_mesa\')').all();
  const porNombre = Object.fromEntries(cols.map((c) => [c.name, c]));

  // Si mesa_id no es obligatorio, la tabla ya está actualizada; solo faltarían columnas
  if (!porNombre.mesa_id || porNombre.mesa_id.nn !== 1) {
    if (!porNombre.cliente) await db.exec('ALTER TABLE cuentas_mesa ADD COLUMN cliente TEXT');
    if (!porNombre.tipo) await db.exec("ALTER TABLE cuentas_mesa ADD COLUMN tipo TEXT NOT NULL DEFAULT 'MESA'");
    await db.exec('CREATE INDEX IF NOT EXISTS idx_cuentas_estado ON cuentas_mesa(estado, tipo)');
    return;
  }

  // PRAGMA foreign_keys solo aplica en SQLite local (Turso lo mantiene siempre activo)
  const modoLocal = db.modo === 'local';
  if (modoLocal) await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.transaccion(async (tx) => {
      await tx.exec(`
        CREATE TABLE cuentas_mesa_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mesa_id INTEGER REFERENCES mesas(id),
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          cliente TEXT,
          tipo TEXT NOT NULL DEFAULT 'MESA' CHECK(tipo IN ('MESA','MOSTRADOR')),
          estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK(estado IN ('ABIERTA','CERRADA')),
          apertura_en TEXT NOT NULL,
          cierre_en TEXT
        );
      `);
      await tx.exec(`
        INSERT INTO cuentas_mesa_new (id, mesa_id, usuario_id, cliente, tipo, estado, apertura_en, cierre_en)
        SELECT id, mesa_id, usuario_id, NULL, 'MESA', estado, apertura_en, cierre_en FROM cuentas_mesa;
      `);
      await tx.exec('DROP TABLE cuentas_mesa');
      await tx.exec('ALTER TABLE cuentas_mesa_new RENAME TO cuentas_mesa');
      await tx.exec('CREATE INDEX IF NOT EXISTS idx_cuentas_mesa_mesa ON cuentas_mesa(mesa_id, estado)');
      await tx.exec('CREATE INDEX IF NOT EXISTS idx_cuentas_estado ON cuentas_mesa(estado, tipo)');
    });
    console.log('Migración aplicada: cuentas_mesa admite cuentas sin mesa.');
  } finally {
    if (modoLocal) await db.exec('PRAGMA foreign_keys = ON');
  }
}

// Fase G: agrega "zona" a las mesas y cambia la unicidad de numero a (zona, numero).
// SQLite no permite quitar un UNIQUE con ALTER, así que se reconstruye la tabla
// conservando los id (para no romper las cuentas/ventas que apuntan a la mesa).
async function migrarMesasZonas() {
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('mesas')").all()).map((c) => c.name);
  if (cols.includes('zona')) return; // ya migrada

  const modoLocal = db.modo === 'local';
  if (modoLocal) await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.transaccion(async (tx) => {
      await tx.exec(`
        CREATE TABLE mesas_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          numero INTEGER NOT NULL,
          zona TEXT NOT NULL DEFAULT '',
          nombre_cliente TEXT,
          estado TEXT NOT NULL DEFAULT 'LIBRE' CHECK(estado IN ('LIBRE','OCUPADA','CERRADA')),
          UNIQUE(zona, numero)
        );
      `);
      await tx.exec(`INSERT INTO mesas_new (id, numero, zona, nombre_cliente, estado)
               SELECT id, numero, '', nombre_cliente, estado FROM mesas;`);
      await tx.exec('DROP TABLE mesas');
      await tx.exec('ALTER TABLE mesas_new RENAME TO mesas');
    });
    console.log('Migración aplicada: mesas con zona y unicidad (zona, numero).');
  } finally {
    if (modoLocal) await db.exec('PRAGMA foreign_keys = ON');
  }
}

// Borra las sesiones expiradas para que la tabla no crezca sin control
export async function limpiarSesiones() {
  const info = await db.prepare('DELETE FROM sesiones WHERE expira_en < ?').run(nowCO());
  return info.changes;
}

// Borra las sesiones expiradas del panel del desarrollador
export async function limpiarSesionesDev() {
  const info = await db.prepare('DELETE FROM sesiones_dev WHERE expira_en < ?').run(nowCO());
  return info.changes;
}

// Crea el primer propietario si no hay ningún usuario
export async function seedAdmin() {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM usuarios').get();
  if (row.c === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.prepare(
      `INSERT INTO usuarios (nombre, correo, usuario, password_hash, rol, debe_cambiar_password, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('Propietario', 'admin@chamalubeer.com', 'admin', hash, 'PROPIETARIO', 1, new Date().toISOString());
    console.log('Usuario propietario creado -> usuario: admin | contraseña: admin123');
    console.log('¡Se pedirá cambiarla en el primer ingreso!');
  }
}
