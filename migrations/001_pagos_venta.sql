CREATE TABLE IF NOT EXISTS pagos_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL,
  metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('EFECTIVO','DATAFONO','TRANSFERENCIA','NEQUI')),
  monto INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pagos_venta_venta ON pagos_venta(venta_id);
