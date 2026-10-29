import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml } from '../ui.js';

let tabActiva = 'negocio';
let promptInstalar = null;

// El navegador avisa cuando la app se puede instalar (Chrome/Edge/Android).
// En iPhone este evento no existe: hay que usar Compartir → Añadir a inicio.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalar = e;
  actualizarBotonInstalar();
});
window.addEventListener('appinstalled', () => {
  promptInstalar = null;
  actualizarBotonInstalar();
});

export async function renderConfiguracion(container) {
  const esPropietario = state.usuario.rol === 'PROPIETARIO';

  const pestanas = [
    { id: 'negocio', texto: 'Negocio' },
    { id: 'cuenta', texto: 'Mi cuenta' },
    ...(esPropietario ? [
      { id: 'alertas', texto: 'Alertas' },
      { id: 'respaldos', texto: 'Respaldos' },
    ] : []),
    { id: 'app', texto: 'App' },
  ];

  if (!pestanas.some((p) => p.id === tabActiva)) tabActiva = 'negocio';

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Configuración</h2>
    </div>

    <div class="config-tabs">
      ${pestanas.map((p) => `
        <button class="config-tab${p.id === tabActiva ? ' activa' : ''}" data-tab="${p.id}">${p.texto}</button>
      `).join('')}
    </div>

    <div class="config-panel${tabActiva === 'negocio' ? ' activa' : ''}" data-panel="negocio">
      <div class="config-seccion">
        <h3>Datos del negocio</h3>
        <label>Nombre del negocio</label>
        <input type="text" id="config-nombre" value="${escapeHtml(state.config.nombre_negocio)}">
        <label>Logo</label>
        <div class="logo-config">
          <img id="config-logo-preview" class="logo-preview" src="${state.config.logo || '/img/logo-default.svg'}" alt="Vista previa del logo">
          <div class="logo-config-info">
            <label class="btn btn-ghost btn-sm logo-boton" for="config-logo">Elegir imagen…</label>
            <input type="file" id="config-logo" accept="image/png,image/jpeg,image/webp" class="input-archivo-oculto">
            <span class="logo-ayuda">PNG, JPG o WEBP (máx. 2 MB)</span>
          </div>
        </div>
        <button id="btn-guardar-config" class="btn btn-primary">Guardar cambios</button>
      </div>
    </div>

    <div class="config-panel${tabActiva === 'cuenta' ? ' activa' : ''}" data-panel="cuenta">
      <div class="config-seccion">
        <h3>Mi cuenta</h3>
        <label>Nombre</label>
        <input type="text" id="mi-nombre" value="${escapeHtml(state.usuario.nombre)}">
        <label>Apodo</label>
        <input type="text" id="mi-apodo" value="${escapeHtml(state.usuario.apodo || '')}">
        ${esPropietario ? `
          <label>Usuario (para iniciar sesión)</label>
          <input type="text" id="mi-usuario" value="${escapeHtml(state.usuario.usuario || '')}" autocomplete="off">
          <label>Correo electrónico</label>
          <input type="email" id="mi-correo" value="${escapeHtml(state.usuario.correo || '')}" autocomplete="off">
          <label>Rol</label>
          <input type="text" id="mi-rol" value="${escapeHtml(state.usuario.rol)}" class="input-readonly" readonly>
        ` : ''}
        <button id="btn-actualizar-perfil" class="btn btn-primary">Guardar datos de cuenta</button>
      </div>
      <div class="config-seccion">
        <h3>Cambiar contraseña</h3>
        ${esPropietario ? `
          <label>Contraseña actual</label>
          <input type="password" id="mi-password-actual" autocomplete="current-password">
          <label>Nueva contraseña (mínimo 6 caracteres)</label>
          <input type="password" id="mi-password-nuevo" autocomplete="new-password">
          <button id="btn-cambiar-password" class="btn btn-primary">Cambiar contraseña</button>
        ` : `
          <p class="placeholder">Solo el propietario puede cambiar la contraseña.</p>
        `}
      </div>
    </div>

    ${esPropietario ? `
      <div class="config-panel${tabActiva === 'alertas' ? ' activa' : ''}" data-panel="alertas">
        <div class="config-seccion">
          <h3>Límites de alerta</h3>
          <label>Límite de caja chica (COP)</label>
          <input type="number" id="config-limite-caja" min="0" step="1000" value="50000">
          <label>Stock mínimo por defecto</label>
          <input type="number" id="config-stock-min" min="0" value="5">
          <button id="btn-guardar-alertas" class="btn btn-primary">Guardar límites</button>
        </div>
      </div>

      <div class="config-panel${tabActiva === 'respaldos' ? ' activa' : ''}" data-panel="respaldos">
        <div class="config-seccion">
          <h3>Copias de seguridad</h3>
          <p class="placeholder">Se guardan las últimas 10 copias. La más reciente arriba.</p>
          <button id="btn-crear-backup" class="btn btn-primary btn-sm">Crear copia ahora</button>
          <div id="lista-backups" class="lista-backups"></div>
        </div>
      </div>
    ` : ''}

    <div class="config-panel${tabActiva === 'app' ? ' activa' : ''}" data-panel="app">
      <div class="config-seccion">
        <h3>Aplicación</h3>
        <p class="placeholder">Versión instalada: <strong>v${escapeHtml(state.version || '')}</strong></p>
        <button id="btn-instalar" class="btn btn-primary" hidden>Instalar app</button>
        <p id="instalar-estado" class="placeholder"></p>
        <p class="placeholder">
          En Android o PC: menú del navegador → “Instalar aplicación”.<br>
          En iPhone: Compartir → “Añadir a pantalla de inicio”.
        </p>
      </div>
    </div>
  `;

  // Pestañas
  container.querySelectorAll('.config-tab').forEach((boton) => {
    boton.addEventListener('click', () => {
      tabActiva = boton.dataset.tab;
      container.querySelectorAll('.config-tab').forEach((b) => b.classList.toggle('activa', b === boton));
      container.querySelectorAll('.config-panel').forEach((p) => {
        p.classList.toggle('activa', p.dataset.panel === tabActiva);
      });
    });
  });

  await cargarConfig();

  container.querySelector('#btn-guardar-config')?.addEventListener('click', guardarConfig);
  container.querySelector('#btn-guardar-alertas')?.addEventListener('click', guardarConfig);
  container.querySelector('#btn-actualizar-perfil')?.addEventListener('click', actualizarPerfil);
  container.querySelector('#btn-instalar')?.addEventListener('click', instalarApp);
  container.querySelector('#config-logo')?.addEventListener('change', subirLogo);
  if (esPropietario) {
    container.querySelector('#btn-cambiar-password')?.addEventListener('click', cambiarPassword);
    container.querySelector('#btn-crear-backup')?.addEventListener('click', crearBackup);
    await cargarBackups();
  }

  actualizarBotonInstalar();
}

function actualizarBotonInstalar() {
  const boton = document.getElementById('btn-instalar');
  const estado = document.getElementById('instalar-estado');
  if (!boton) return;

  const yaInstalada = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (yaInstalada) {
    boton.hidden = true;
    if (estado) estado.textContent = 'La app ya está instalada.';
    return;
  }
  if (promptInstalar) {
    boton.hidden = false;
    if (estado) estado.textContent = '';
    return;
  }
  boton.hidden = true;
  if (estado) estado.textContent = 'Si el botón no aparece, instálala desde el menú del navegador (ver abajo).';
}

async function instalarApp() {
  if (!promptInstalar) return;
  promptInstalar.prompt();
  try {
    const eleccion = await promptInstalar.userChoice;
    if (eleccion?.outcome === 'accepted') toast('App instalada', 'success');
  } catch {
    // si el navegador cancela, no hacemos nada
  }
  promptInstalar = null;
  actualizarBotonInstalar();
}

async function cargarBackups() {
  const lista = document.getElementById('lista-backups');
  if (!lista) return;
  try {
    const copias = await api('/api/configuracion/backups');
    if (copias.length === 0) {
      lista.innerHTML = '<p class="placeholder">Aún no hay copias.</p>';
      return;
    }
    lista.innerHTML = copias.map((c) => `
      <div class="item-backup">
        <span class="backup-nombre">${escapeHtml(c.nombre)}</span>
        <span class="backup-fecha">${escapeHtml(new Date(c.fecha).toLocaleString('es-CO'))}</span>
        <span class="backup-tamano">${(c.tamano / 1024).toFixed(0)} KB</span>
        <a class="btn btn-ghost btn-sm" href="/api/configuracion/backups/${encodeURIComponent(c.nombre)}">Descargar</a>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function crearBackup() {
  try {
    await api('/api/configuracion/backups', { method: 'POST' });
    toast('Copia de seguridad creada', 'success');
    await cargarBackups();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cargarConfig() {
  try {
    const config = await api('/api/configuracion');
    const limiteInput = document.getElementById('config-limite-caja');
    const stockInput = document.getElementById('config-stock-min');
    if (limiteInput && config.limite_caja_chica) limiteInput.value = config.limite_caja_chica;
    if (stockInput && config.stock_minimo_defecto) stockInput.value = config.stock_minimo_defecto;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function guardarConfig() {
  const body = {
    nombre_negocio: document.getElementById('config-nombre').value.trim(),
  };
  const limite = document.getElementById('config-limite-caja');
  const stock = document.getElementById('config-stock-min');
  if (limite) body.limite_caja_chica = parseInt(limite.value, 10) || 0;
  if (stock) body.stock_minimo_defecto = parseInt(stock.value, 10) || 0;
  try {
    await api('/api/configuracion', { method: 'PUT', body: JSON.stringify(body) });
    state.config.nombre_negocio = body.nombre_negocio;
    const topbarNombre = document.getElementById('topbar-nombre');
    if (topbarNombre) topbarNombre.textContent = body.nombre_negocio;
    toast('Configuración guardada', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function subirLogo(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('La imagen no puede superar 2 MB', 'error');
    e.target.value = '';
    return;
  }
  const base64 = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  const preview = document.getElementById('config-logo-preview');
  const anterior = preview.src;
  preview.src = base64; // vista previa instantánea
  try {
    const result = await api('/api/configuracion/logo', {
      method: 'POST',
      body: JSON.stringify({ imagen_base64: base64 }),
    });
    if (result.url) {
      state.config.logo = result.url;
      preview.src = result.url;
      const topbar = document.getElementById('topbar-logo');
      if (topbar) topbar.src = result.url;
    }
    toast('Logo actualizado', 'success');
  } catch (err) {
    preview.src = anterior;
    toast(err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function actualizarPerfil() {
  const nombre = document.getElementById('mi-nombre').value.trim();
  const apodo = document.getElementById('mi-apodo').value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  const body = { nombre, apodo };
  const usuarioEl = document.getElementById('mi-usuario');
  const correoEl = document.getElementById('mi-correo');
  if (usuarioEl) body.usuario = usuarioEl.value.trim();
  if (correoEl) body.correo = correoEl.value.trim();
  try {
    const r = await api('/api/usuarios/perfil', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    // Actualizamos los datos en pantalla
    state.usuario.nombre = nombre;
    state.usuario.apodo = apodo || null;
    if (r.usuario !== undefined) state.usuario.usuario = r.usuario;
    if (r.correo !== undefined) state.usuario.correo = r.correo;
    const nombreMostrar = state.usuario.apodo || state.usuario.nombre;
    document.getElementById('topbar-user').innerHTML =
      `${escapeHtml(nombreMostrar)} <span class="rol ${state.usuario.rol}">${state.usuario.rol}</span>`;
    toast('Cuenta actualizada', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cambiarPassword() {
  const actual = document.getElementById('mi-password-actual').value;
  const nuevo = document.getElementById('mi-password-nuevo').value;
  if (!actual || !nuevo) {
    toast('Completa ambos campos', 'error');
    return;
  }
  try {
    await api('/api/usuarios/cambiar-password', {
      method: 'POST',
      body: JSON.stringify({ password_actual: actual, password_nuevo: nuevo }),
    });
    toast('Contraseña cambiada', 'success');
    document.getElementById('mi-password-actual').value = '';
    document.getElementById('mi-password-nuevo').value = '';
  } catch (err) {
    toast(err.message, 'error');
  }
}
