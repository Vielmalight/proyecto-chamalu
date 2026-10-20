import { db } from '../config/db.js';
import { nowCO } from '../config/constants.js';

// Registra una acción importante en el log de auditoría
// usuarioId es opcional (por ejemplo, en el login aún no hay req.usuario)
// Devuelve una promesa; los fallos jamás bloquean la operación principal.
export function logAuditoria(req, accion, detalle = '', usuarioId = undefined) {
  try {
    const id = usuarioId !== undefined ? usuarioId : req.usuario?.id ?? null;
    // Promise.resolve funciona tanto con el valor síncrono (SQLite local)
    // como con la promesa (modo remoto)
    return Promise.resolve(
      db.prepare(
        'INSERT INTO logs_auditoria (usuario_id, accion, detalle, ip, fecha) VALUES (?, ?, ?, ?, ?)'
      ).run(id, accion, detalle, req.ip || '', nowCO())
    ).catch(() => {
      // Si falla el log, no bloquea la operación principal
    });
  } catch {
    return Promise.resolve();
  }
}
