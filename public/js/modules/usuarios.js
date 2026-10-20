import { api } from '../api.js';
import { toast, escapeHtml } from '../ui.js';

// Refresco automático de la lista (Fase E3)
let refrescoTimer = null;
const INTERVALO_REFRESCO_MS = 10000;

// Texto "hace X" a partir de los minutos sin actividad
function textoHace(min) {
  if (min == null) return '';
  if (min < 1) return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

function badgePresencia(u) {
  if (u.en_linea) {
    return '<span class="usuario-presencia en-linea"><span class="presencia-punto"></span>En línea</span>';
  }
  const hace = textoHace(u.minutos_inactivo);
  return `<span class="usuario-presencia desconectado"><span class="presencia-punto"></span>Desconectado${hace ? ` · ${hace}` : ''}</span>`;
}

export async function renderUsuarios(container) {
  if (refrescoTimer) { clearInterval(refrescoTimer); refrescoTimer = null; }

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Usuarios</h2>
      <button id="btn-nuevo-usuario" class="btn btn-primary">Nuevo usuario</button>
    </div>
    <div id="lista-usuarios" class="lista-usuarios"></div>
  `;

  await cargarUsuarios();

  // Se actualiza sola mientras la pestaña Usuarios esté abierta
  refrescoTimer = setInterval(() => {
    if (!document.getElementById('lista-usuarios')) {
      clearInterval(refrescoTimer);
      refrescoTimer = null;
      return;
    }
    cargarUsuarios();
  }, INTERVALO_REFRESCO_MS);

  container.querySelector('#btn-nuevo-usuario')?.addEventListener('click', () => modalUsuario());
}

async function cargarUsuarios() {
  const lista = document.getElementById('lista-usuarios');
  if (!lista) return;
  try {
    const usuarios = await api('/api/usuarios');
    if (usuarios.length === 0) {
      lista.innerHTML = '<p class="placeholder">No hay usuarios.</p>';
      return;
    }
    lista.innerHTML = usuarios.map((u) => `
      <div class="item-usuario">
        <div class="usuario-info">
          <span class="usuario-nombre">${escapeHtml(u.nombre)}</span>
          <span class="usuario-rol ${u.rol}">${u.rol}</span>
          <span class="usuario-usuario">@${escapeHtml(u.usuario)}</span>
        </div>
        ${badgePresencia(u)}
        <span class="usuario-estado ${u.activo ? 'activo' : 'inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span>
        <div class="usuario-acciones">
          <button class="btn btn-ghost btn-sm" onclick="editarUsuario(${u.id})">Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="restablecerPassword(${u.id})">Restablecer contraseña</button>
          ${u.activo
            ? (u.rol === 'CAJERO' ? `<button class="btn btn-ghost btn-sm text-danger" onclick="desactivarUsuario(${u.id})">Desactivar</button>` : '')
            : `<button class="btn btn-ghost btn-sm" onclick="activarUsuario(${u.id})">Activar</button>`}
          <button class="btn btn-ghost btn-sm text-danger" onclick="eliminarUsuario(${u.id})">Eliminar</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function modalUsuario(id = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${id ? 'Editar' : 'Nuevo'} usuario</h2>
      <label>Nombre completo *</label>
      <input type="text" id="user-nombre">
      <label>Apodo (opcional)</label>
      <input type="text" id="user-apodo">
      <label>Correo (opcional)</label>
      <input type="email" id="user-correo">
      <label>Usuario *</label>
      <input type="text" id="user-usuario">
      <label>Contraseña ${id ? '(dejar vacío para no cambiar)' : '*'}</label>
      <input type="password" id="user-password">
      <label>Rol</label>
      <select id="user-rol">
        <option value="CAJERO">Cajero</option>
        <option value="PROPIETARIO">Propietario</option>
      </select>
      <div class="error-msg" id="user-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="user-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="user-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  if (id) {
    api('/api/usuarios').then((usuarios) => {
      const u = usuarios.find((x) => x.id === id);
      if (u) {
        overlay.querySelector('#user-nombre').value = u.nombre;
        overlay.querySelector('#user-apodo').value = u.apodo || '';
        overlay.querySelector('#user-correo').value = u.correo || '';
        overlay.querySelector('#user-usuario').value = u.usuario;
        overlay.querySelector('#user-rol').value = u.rol;
      }
    });
  }

  overlay.querySelector('#user-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#user-guardar').addEventListener('click', async () => {
    const body = {
      nombre: overlay.querySelector('#user-nombre').value.trim(),
      apodo: overlay.querySelector('#user-apodo').value.trim(),
      correo: overlay.querySelector('#user-correo').value.trim(),
      usuario: overlay.querySelector('#user-usuario').value.trim(),
      password: overlay.querySelector('#user-password').value,
      rol: overlay.querySelector('#user-rol').value,
    };
    const errEl = overlay.querySelector('#user-error');
    if (!body.nombre || !body.usuario) { errEl.textContent = 'Nombre y usuario son obligatorios'; return; }
    if (!id && !body.password) { errEl.textContent = 'La contraseña es obligatoria'; return; }
    try {
      if (id) {
        await api(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/api/usuarios', { method: 'POST', body: JSON.stringify(body) });
      }
      overlay.remove();
      toast('Usuario guardado', 'success');
      cargarUsuarios();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

window.editarUsuario = (id) => modalUsuario(id);

window.restablecerPassword = async (id) => {
  const nueva = prompt('Nueva contraseña (mínimo 6 caracteres):');
  if (!nueva || nueva.length < 6) {
    toast('Contraseña inválida', 'error');
    return;
  }
  try {
    await api(`/api/usuarios/restablecer-password/${id}`, {
      method: 'POST',
      body: JSON.stringify({ nueva_password: nueva }),
    });
    toast('Contraseña restablecida', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.desactivarUsuario = async (id) => {
  if (!confirm('¿Desactivar este usuario?')) return;
  try {
    await api(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify({ activo: false }) });
    toast('Usuario desactivado', 'success');
    cargarUsuarios();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.activarUsuario = async (id) => {
  try {
    await api(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify({ activo: true }) });
    toast('Usuario activado', 'success');
    cargarUsuarios();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.eliminarUsuario = async (id) => {
  if (!confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
  try {
    await api(`/api/usuarios/${id}`, { method: 'DELETE' });
    toast('Usuario eliminado', 'success');
    cargarUsuarios();
  } catch (err) {
    toast(err.message, 'error');
  }
};
