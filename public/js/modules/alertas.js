import { api } from '../api.js';
import { toast, escapeHtml } from '../ui.js';

let filtroActual = 'no-leidas';

export async function renderAlertas(container) {
  container.innerHTML = `
    <div class="modulo-header">
      <h2>Alertas</h2>
    </div>
    <div class="filtros">
      <button class="chip-filtro" data-filtro="no-leidas">No leídas</button>
      <button class="chip-filtro" data-filtro="leidas">Leídas</button>
    </div>
    <div id="lista-alertas" class="lista-alertas"></div>
  `;

  container.querySelectorAll('[data-filtro]').forEach((b) => {
    b.addEventListener('click', () => {
      filtroActual = b.dataset.filtro;
      marcarChipActivo();
      cargarAlertas();
    });
  });
  marcarChipActivo();

  await cargarAlertas();
}

function marcarChipActivo() {
  document.querySelectorAll('[data-filtro]').forEach((b) => {
    b.classList.toggle('active', b.dataset.filtro === filtroActual);
  });
}

async function cargarAlertas() {
  const lista = document.getElementById('lista-alertas');
  if (!lista) return;
  try {
    const alertas = await api(`/api/alertas?filtro=${filtroActual}`);
    if (alertas.length === 0) {
      lista.innerHTML = '<p class="placeholder">No hay alertas para mostrar.</p>';
      return;
    }
    lista.innerHTML = alertas.map((a) => `
      <div class="item-alerta ${a.leida ? 'alerta-leida' : 'alerta-no-leida'}">
        <span class="alerta-mensaje">${escapeHtml(a.mensaje)}</span>
        <span class="alerta-fecha">${escapeHtml(a.creado_en)}</span>
        ${a.leida
          ? `<button class="btn btn-ghost btn-sm" onclick="marcarNoLeida(${a.id})">Marcar no leída</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="marcarLeida(${a.id})">Marcar leída</button>`}
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

window.marcarLeida = async (id) => {
  try {
    await api(`/api/alertas/${id}/leer`, { method: 'POST' });
    cargarAlertas();
    window.dispatchEvent(new Event('alertas-cambio'));
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.marcarNoLeida = async (id) => {
  try {
    await api(`/api/alertas/${id}/no-leer`, { method: 'POST' });
    cargarAlertas();
    window.dispatchEvent(new Event('alertas-cambio'));
  } catch (err) {
    toast(err.message, 'error');
  }
};
