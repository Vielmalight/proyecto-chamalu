CREATE TABLE IF NOT EXISTS migrations_aplicadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  fecha_aplicacion TEXT NOT NULL DEFAULT (datetime('now'))
);
