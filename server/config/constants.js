export const ROLES = { PROPIETARIO: 'PROPIETARIO', CAJERO: 'CAJERO' };

export const MODULOS = [
  { id: 'inicio', nombre: 'Inicio' },
  { id: 'facturacion', nombre: 'Facturación' },
  { id: 'gestion', nombre: 'Gestión' },
  { id: 'mesas', nombre: 'Mesas' },
  { id: 'ventas', nombre: 'Ventas' },
  { id: 'reportes', nombre: 'Reportes' },
  { id: 'caja', nombre: 'Caja' },
  { id: 'alertas', nombre: 'Alertas' },
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'configuracion', nombre: 'Configuración' },
];

// Módulos que puede ver cada rol (filtra en el servidor, no solo en la pantalla)
export const MODULOS_POR_ROL = {
  PROPIETARIO: MODULOS.map((m) => m.id),
  CAJERO: ['inicio', 'facturacion', 'ventas', 'gestion', 'alertas'],
};

// Hora actual en Colombia (UTC-5, sin horario de verano) -> 'YYYY-MM-DD HH:MM:SS'
export function nowCO() {
  const co = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return co.toISOString().slice(0, 19).replace('T', ' ');
}

// Suma minutos a una fecha 'YYYY-MM-DD HH:MM:SS' y devuelve el mismo formato
export function sumarMinutos(fechaStr, minutos) {
  const d = new Date(fechaStr.replace(' ', 'T') + 'Z');
  d.setUTCMinutes(d.getUTCMinutes() + minutos);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
