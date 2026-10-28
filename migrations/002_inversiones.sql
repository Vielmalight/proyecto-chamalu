CREATE TABLE IF NOT EXISTS inversiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  monto INTEGER NOT NULL CHECK(monto > 0),
  origen TEXT NOT NULL CHECK(origen IN ('CAJA','BOLSILLO')),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  turno_id INTEGER REFERENCES turnos_caja(id),
  movimiento_caja_chica_id INTEGER REFERENCES movimientos_caja_chica(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inversiones_fecha ON inversiones(fecha);
