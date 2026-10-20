import { api } from '../api.js';

export async function intentarLogin(usuario, password) {
  return api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ usuario, password }),
  });
}

export async function obtenerSesion() {
  return api('/api/auth/me');
}

export async function cerrarSesion() {
  return api('/api/auth/logout', { method: 'POST' });
}

export async function abrirCaja(monto_apertura, monto_caja_chica) {
  return api('/api/caja/apertura', {
    method: 'POST',
    body: JSON.stringify({ monto_apertura, monto_caja_chica }),
  });
}

export async function cambiarPassword(password_actual, password_nuevo) {
  return api('/api/usuarios/cambiar-password', {
    method: 'POST',
    body: JSON.stringify({ password_actual, password_nuevo }),
  });
}
