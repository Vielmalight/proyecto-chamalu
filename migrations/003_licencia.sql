-- Interruptor de acceso (licencia) y sesiones del panel del desarrollador.
-- La licencia es una sola fila (id = 1). Por defecto queda activa.

CREATE TABLE IF NOT EXISTS licencia (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'suspendida')),
  mensaje TEXT,
  fecha_cambio TEXT NOT NULL
);

INSERT OR IGNORE INTO licencia (id, estado, mensaje, fecha_cambio)
VALUES (1, 'activa', NULL, datetime('now', '-5 hours'));

CREATE TABLE IF NOT EXISTS licencia_historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  estado_anterior TEXT NOT NULL,
  estado_nuevo TEXT NOT NULL,
  mensaje TEXT
);

CREATE TABLE IF NOT EXISTS sesiones_dev (
  token TEXT PRIMARY KEY,
  creado_en TEXT NOT NULL,
  ultima_actividad TEXT NOT NULL,
  expira_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sesiones_dev_expira ON sesiones_dev(expira_en);
