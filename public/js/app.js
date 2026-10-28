import { intentarLogin, obtenerSesion, cerrarSesion, abrirCaja, cambiarPassword } from './modules/auth.js';
import { renderInicio } from './modules/inicio.js';
import { renderAuth } from './modules/auth.js';
import { renderFacturacion } from './modules/facturacion.js';
import { renderGestion } from './modules/gestion.js';
import { renderMesas } from './modules/mesas.js';
import { renderVentas } from './modules/ventas.js';
import { renderReportes } from './modules/reportes.js';
import { renderCaja } from './modules/caja.js';
import { renderInversiones } from './modules/inversiones.js';
import { renderAlertas } from './modules/alertas.js';
import { renderUsuarios } from './modules/usuarios.js';
import { renderConfiguracion } from './modules/configuracion.js';
import { state } from './state.js';
import { api } from './api.js';
import { setTheme, escapeHtml, toast, mostrar, ocultar } from './ui.js';

const modulosRender = {
  inicio: renderInicio,
  facturacion: renderFacturacion,
  gestion: renderGestion,
  mesas: renderMesas,
  ventas: renderVentas,
  reportes: renderReportes,
  caja: renderCaja,
  inversiones: renderInversiones,
  alertas: renderAlertas,
  usuarios: renderUsuarios,
  configuracion: renderConfiguracion,
};

const MODULOS_NOMBRES = {
  inicio: 'Inicio',
  facturacion: 'Facturación',
  gestion: 'Gestión',
  mesas: 'Mesas',
  ventas: 'Ventas',
  reportes: 'Reportes',
  caja: 'Caja',
  inversiones: 'Inversiones',
  alertas: 'Alertas',
  usuarios: 'Usuarios',
  configuracion: 'Configuración',
};

function aplicarTema() {
  setTheme('dark');
}

// Agrupación del menú lateral (Fase 3)
const GRUPOS_MENU = [
  { titulo: 'Operación', modulos: ['inicio', 'facturacion', 'ventas', 'caja', 'inversiones'] },
  { titulo: 'Catálogo', modulos: ['gestion'] },
  { titulo: 'Análisis', modulos: ['reportes', 'alertas'] },
  { titulo: 'Sistema', modulos: ['mesas', 'usuarios', 'configuracion'] },
];

function renderSidebar() {
  const nav = document.getElementById('sidebar');
  nav.innerHTML = '';
  const mostrados = new Set();

  const crearBoton = (id) => {
    const b = document.createElement('button');
    b.dataset.modulo = id;
    const label = document.createElement('span');
    label.textContent = MODULOS_NOMBRES[id] || id;
    b.appendChild(label);
    if (id === 'alertas') {
      const badge = document.createElement('span');
      badge.id = 'badge-alertas';
      badge.className = 'badge-alertas hidden';
      b.appendChild(badge);
    }
    b.addEventListener('click', () => seleccionarModulo(id));
    nav.appendChild(b);
    mostrados.add(id);
  };

  for (const grupo of GRUPOS_MENU) {
    const presentes = grupo.modulos.filter((id) => state.modulos.includes(id) && !mostrados.has(id));
    if (presentes.length === 0) continue;
    const titulo = document.createElement('div');
    titulo.className = 'menu-grupo';
    titulo.textContent = grupo.titulo;
    nav.appendChild(titulo);
    presentes.forEach(crearBoton);
  }

  // Seguridad: cualquier módulo no contemplado en los grupos se muestra igual
  state.modulos.filter((id) => !mostrados.has(id)).forEach(crearBoton);

  // Versión de la app, siempre visible al pie del menú (Fase G)
  if (state.version) {
    const pie = document.createElement('div');
    pie.className = 'menu-version';
    pie.textContent = `Chamalú Beer v${state.version}`;
    nav.appendChild(pie);
  }
}

// Contador de alertas nuevas en el menú (Fase 2 - punto K)
async function refrescarBadgeAlertas() {
  const badge = document.getElementById('badge-alertas');
  if (!badge) return;
  try {
    const alertas = await api('/api/alertas');
    const n = alertas.length;
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  } catch {
    // Silencioso: es solo un aviso
  }
}

function seleccionarModulo(id) {
  document.querySelectorAll('#sidebar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.modulo === id);
  });
  const content = document.getElementById('content');
  content.classList.remove('content-full');
  const render = modulosRender[id];
  if (render) {
    render(content);
  } else {
    content.innerHTML = `<h2>${escapeHtml(MODULOS_NOMBRES[id] || id)}</h2>
      <p class="placeholder">Módulo en construcción.</p>`;
  }
  refrescarBadgeAlertas();
}

function renderTopbar() {
  document.getElementById('topbar-nombre').textContent = state.config.nombre_negocio;
  const logo = document.getElementById('topbar-logo');
  logo.src = state.config.logo || '/img/logo-default.svg';
  const u = state.usuario;
  const nombre = u.apodo || u.nombre;
  document.getElementById('topbar-user').innerHTML =
    `${escapeHtml(nombre)} <span class="rol ${u.rol}">${u.rol}</span>`;
}

function mostrarShell() {
  ocultar('login-view');
  mostrar('app-view');
  aplicarTema();
  renderTopbar();
  renderSidebar();
  seleccionarModulo('inicio');
  iniciarAvisosAlertas();
}

let badgeTimer = null;
let badgeEscuchando = false;

// Aviso de alertas nuevas en el menú (Fase 2 - punto K)
function iniciarAvisosAlertas() {
  if (!badgeEscuchando) {
    window.addEventListener('alertas-cambio', refrescarBadgeAlertas);
    badgeEscuchando = true;
  }
  if (!badgeTimer) badgeTimer = setInterval(refrescarBadgeAlertas, 60000);
  refrescarBadgeAlertas();
}

async function flujoPostLogin(datos) {
  Object.assign(state, datos);
  if (state.usuario.debe_cambiar_password) {
    mostrar('modal-password');
  } else if (!state.turno_caja) {
    mostrar('modal-caja');
  } else {
    mostrarShell();
  }
}

function bindLogin() {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const usuario = document.getElementById('login-usuario').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const datos = await intentarLogin(usuario, password);
      await flujoPostLogin(datos);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function bindModalPassword() {
  const btn = document.getElementById('btn-cambiar-pass');
  const errorEl = document.getElementById('pass-error');
  btn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const actual = document.getElementById('pass-actual').value;
    const nueva = document.getElementById('pass-nueva').value;
    if (!actual || !nueva) {
      errorEl.textContent = 'Completa ambos campos';
      return;
    }
    try {
      await cambiarPassword(actual, nueva);
      const datos = await obtenerSesion();
      ocultar('modal-password');
      toast('Contraseña actualizada', 'success');
      await flujoPostLogin(datos);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function bindModalCaja() {
  const btn = document.getElementById('btn-apertura');
  const errorEl = document.getElementById('caja-error');
  btn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const monto_apertura = parseInt(document.getElementById('apertura-mayor').value, 10) || 0;
    const monto_caja_chica = parseInt(document.getElementById('apertura-menor').value, 10) || 0;
    try {
      await abrirCaja(monto_apertura, monto_caja_chica);
      const datos = await obtenerSesion();
      ocultar('modal-caja');
      mostrarShell();
      toast('Caja abierta correctamente', 'success');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function bindLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await cerrarSesion().catch(() => {});
    location.reload();
  });
}

// Menú lateral ocultable (Fase E2)
function bindMenu() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('btn-menu');
  const hover = document.getElementById('menu-hover');
  let oculto = localStorage.getItem('chamalu_menu_oculto') === '1';

  const aplicar = () => {
    sidebar.classList.toggle('oculto', oculto);
    btn.title = oculto ? 'Mostrar menú' : 'Ocultar menú';
    hover.classList.toggle('activo', oculto);
    if (!oculto) sidebar.classList.remove('flotante');
  };

  btn.addEventListener('click', () => {
    oculto = !oculto;
    localStorage.setItem('chamalu_menu_oculto', oculto ? '1' : '0');
    aplicar();
  });

  // Al pasar el mouse por el borde izquierdo, el menú reaparece flotante
  hover.addEventListener('mouseenter', () => {
    if (oculto) sidebar.classList.add('flotante');
  });
  sidebar.addEventListener('mouseleave', () => {
    if (oculto) sidebar.classList.remove('flotante');
  });

  aplicar();
}

async function init() {
  bindLogin();
  bindModalCaja();
  bindModalPassword();
  bindLogout();
  bindMenu();
  aplicarTema();
  try {
    const datos = await obtenerSesion();
    await flujoPostLogin(datos);
  } catch {
    mostrar('login-view');
  }
}

init();
