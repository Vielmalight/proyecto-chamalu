import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml, hoyCO, vigilarCambioDeDia } from '../ui.js';

// Apodo (o nombre) + el rol que hizo la venta
function etiquetaUsuario(apodo, nombre, rol) {
  const base = apodo || nombre || '';
  const badge = rol ? ` <span class="usuario-rol ${escapeHtml(rol)}">${escapeHtml(rol)}</span>` : '';
  return `${escapeHtml(base)}${badge}`;
}

// Paginación de "Ver todas" (Fase G)
const POR_PAGINA = 50;
let verTodas = false;
let pagina = 0;

export async function renderVentas(container) {
  // Por defecto se muestran todas las ventas (paginadas, de la más antigua a la más reciente)
  verTodas = true;
  pagina = 0;

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Ventas</h2>
    </div>
    <div class="filtros">
      <input type="date" id="filtro-fecha" class="input-buscar" value="${hoyCO()}">
      <select id="filtro-metodo" class="select-categoria">
        <option value="">Todos los métodos</option>
        <option value="EFECTIVO">Efectivo</option>
        <option value="DATAFONO">Datáfono</option>
        <option value="TRANSFERENCIA">Transferencia</option>
        <option value="NEQUI">Nequi</option>
      </select>
      <button id="filtro-ver-todas" class="btn btn-ghost" title="Ver las ventas de todos los días">Ver todas</button>
    </div>
    <div id="lista-ventas" class="lista-ventas"></div>
    <div id="ventas-paginacion" class="paginacion hidden">
      <button id="pag-anterior" class="btn btn-ghost btn-sm">Anterior</button>
      <span id="pag-info"></span>
      <button id="pag-siguiente" class="btn btn-ghost btn-sm">Siguiente</button>
    </div>
  `;

  await cargarVentas();

  container.querySelector('#filtro-fecha')?.addEventListener('change', () => { pagina = 0; cargarVentas(); });
  container.querySelector('#filtro-metodo')?.addEventListener('change', () => { pagina = 0; cargarVentas(); });
  container.querySelector('#filtro-ver-todas')?.addEventListener('click', () => {
    verTodas = !verTodas;
    pagina = 0;
    actualizarModo();
    cargarVentas();
  });
  container.querySelector('#pag-anterior')?.addEventListener('click', () => {
    if (pagina > 0) { pagina -= 1; cargarVentas(); }
  });
  container.querySelector('#pag-siguiente')?.addEventListener('click', () => {
    pagina += 1; cargarVentas();
  });

  // Al cambiar el día, si el usuario no eligió otra fecha, saltamos a "hoy"
  let dia = hoyCO();
  vigilarCambioDeDia((nuevo) => {
    if (verTodas) { dia = nuevo; return; }
    const fechaEl = container.querySelector('#filtro-fecha');
    if (fechaEl && fechaEl.value === dia) {
      fechaEl.value = nuevo;
      cargarVentas();
    }
    dia = nuevo;
  });
}

// Ajusta los controles según el modo (día vs. todas)
function actualizarModo() {
  const fechaEl = document.getElementById('filtro-fecha');
  const btn = document.getElementById('filtro-ver-todas');
  const pag = document.getElementById('ventas-paginacion');
  if (fechaEl) fechaEl.disabled = verTodas;
  if (btn) {
    btn.textContent = verTodas ? 'Ver por día' : 'Ver todas';
    btn.classList.toggle('btn-primary', verTodas);
  }
  if (pag) pag.classList.toggle('hidden', !verTodas);
}

async function cargarVentas() {
  const lista = document.getElementById('lista-ventas');
  const fechaEl = document.getElementById('filtro-fecha');
  const metodoEl = document.getElementById('filtro-metodo');
  if (!lista || !fechaEl || !metodoEl) return;
  actualizarModo();
  const esPropietario = state.usuario.rol === 'PROPIETARIO';
  const fecha = fechaEl.value;
  const metodo = metodoEl.value;
  let url = '/api/ventas?';
  if (verTodas) {
    url += `todas=1&orden=asc&limite=${POR_PAGINA}&offset=${pagina * POR_PAGINA}&`;
  } else if (fecha) {
    url += `fecha=${fecha}&`;
  }
  if (metodo) url += `metodo=${metodo}`;
  try {
    const ventas = await api(url);
    actualizarPaginacion(ventas.length);
    if (ventas.length === 0) {
      lista.innerHTML = '<p class="placeholder">No hay ventas.</p>';
      return;
    }
    lista.innerHTML = ventas.map((v) => {
      const estadoClass = v.estado === 'PAGADA' ? 'venta-pagada' : 'venta-anulada';
      return `
        <div class="item-venta ${estadoClass}">
          <div class="venta-info">
            <span class="venta-fecha">${v.fecha}</span>
            <span class="venta-usuario">${etiquetaUsuario(v.usuario_apodo, v.usuario_nombre, v.usuario_rol)}</span>
            <span class="venta-metodo">${v.metodo_pago}</span>
            ${v.metodo_pago === 'EFECTIVO' ? `<span class="venta-cambio">${(v.cambio || 0) > 0 ? `Cambio: $${v.cambio.toLocaleString('es-CO')}` : 'Sin cambio'}</span>` : ''}
          </div>
          <span class="venta-total">$${v.total.toLocaleString('es-CO')}</span>
          <span class="venta-estado">${v.estado}</span>
          <button class="btn btn-ghost btn-sm" onclick="verVenta(${v.id})">Ver</button>
          ${esPropietario && v.estado === 'PAGADA' ? `
            <button class="btn btn-ghost btn-sm text-danger" onclick="anularVenta(${v.id})">Anular</button>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function actualizarPaginacion(cantidad) {
  const pag = document.getElementById('ventas-paginacion');
  if (!pag || !verTodas) return;
  const info = document.getElementById('pag-info');
  const anterior = document.getElementById('pag-anterior');
  const siguiente = document.getElementById('pag-siguiente');
  if (info) info.textContent = `Página ${pagina + 1}`;
  if (anterior) anterior.disabled = pagina === 0;
  if (siguiente) siguiente.disabled = cantidad < POR_PAGINA;
}

const NOMBRE_METODO = {
  EFECTIVO: 'Efectivo',
  DATAFONO: 'Datáfono',
  TRANSFERENCIA: 'Transferencia',
  NEQUI: 'Nequi',
};

window.verVenta = (id) => modalDetalleVenta(id);

function modalDetalleVenta(id) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal modal-grande"><p>Cargando...</p></div>';
  document.body.appendChild(overlay);

  async function dibujar() {
    const { venta, items } = await api(`/api/ventas/${id}`);
    const esPropietario = state.usuario.rol === 'PROPIETARIO';
    const pesos = (n) => `$${(n || 0).toLocaleString('es-CO')}`;
    const filas = items.length === 0
      ? '<p class="placeholder">Sin productos.</p>'
      : items.map((i) => `
          <div class="item-cuenta ${i.anulado ? 'item-anulado' : ''}">
            <span class="item-cuenta-nombre">${escapeHtml(i.producto_nombre)}</span>
            <span class="item-cuenta-cantidad">x${i.cantidad}</span>
            <span class="item-cuenta-subtotal">${pesos(i.subtotal)}</span>
            ${i.anulado
              ? '<span class="etiqueta-anulado">ANULADO</span>'
              : (esPropietario && venta.estado === 'PAGADA'
                ? `<button class="btn btn-ghost btn-sm text-danger" data-anular="${i.id}">Anular</button>`
                : '')}
          </div>
        `).join('');

    overlay.querySelector('.modal').innerHTML = `
      <h2>Venta #${venta.id}</h2>
      <p>${escapeHtml(venta.fecha)} · ${etiquetaUsuario(venta.usuario_apodo, venta.usuario_nombre, venta.usuario_rol)} · ${escapeHtml(NOMBRE_METODO[venta.metodo_pago] || venta.metodo_pago)}</p>
      <div class="lista-cuenta">${filas}</div>
      <div class="resumen-cobro">
        <div><span>Descuento</span><span>-${pesos(venta.descuento)}</span></div>
        <div><span>Propina (aparte)</span><span>${pesos(venta.propina)}</span></div>
        <div class="total-pagar"><span>Total</span><span>${pesos(venta.total)}</span></div>
        ${venta.metodo_pago === 'EFECTIVO' ? `<div><span>Pago con</span><span>${pesos(venta.pago_con)}</span></div>
        <div><span>Cambio</span><span>${(venta.cambio || 0) > 0 ? pesos(venta.cambio) : 'Sin cambio'}</span></div>` : ''}
      </div>
      <div class="estado-venta">Estado: <strong>${venta.estado}</strong>${venta.motivo_anulacion ? ` · ${escapeHtml(venta.motivo_anulacion)}` : ''}</div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="det-cerrar">Cerrar</button>
      </div>
    `;

    overlay.querySelector('#det-cerrar').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('[data-anular]').forEach((btn) => {
      btn.addEventListener('click', () => anularItem(venta.id, Number(btn.dataset.anular), dibujar, cargarVentas));
    });
  }

  dibujar().catch((err) => {
    overlay.remove();
    toast(err.message, 'error');
  });
}

async function anularItem(ventaId, itemId, refrescarModal, refrescarLista) {
  const motivo = prompt('Motivo de anulación del producto (obligatorio):');
  if (!motivo?.trim()) return;
  try {
    await api(`/api/ventas/${ventaId}/items/${itemId}/anular`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    });
    toast('Producto anulado', 'success');
    await refrescarModal();
    refrescarLista();
  } catch (err) {
    toast(err.message, 'error');
  }
}

window.anularVenta = async (id) => {
  const motivo = prompt('Motivo de anulación (obligatorio):');
  if (!motivo?.trim()) {
    toast('El motivo es obligatorio', 'error');
    return;
  }
  try {
    await api(`/api/ventas/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) });
    toast('Venta anulada', 'success');
    cargarVentas();
  } catch (err) {
    toast(err.message, 'error');
  }
};
