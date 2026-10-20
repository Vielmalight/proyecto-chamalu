import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml, etiquetaMesa } from '../ui.js';

// Caché de mesas para saber qué tarjeta se pulsó
let mesasCache = [];

export async function renderMesas(container) {
  const esPropietario = state.usuario.rol === 'PROPIETARIO';

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Mesas</h2>
      ${esPropietario ? '<button id="btn-nueva-mesa" class="btn btn-primary">Nueva mesa</button>' : ''}
    </div>
    <div id="grid-mesas" class="grid-mesas"></div>
  `;

  await cargarMesas();

  // Toda la tarjeta es el botón: al tocarla se abre el menú de acciones
  container.querySelector('#grid-mesas')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-mesa-id]');
    if (!card) return;
    const mesa = mesasCache.find((m) => String(m.id) === card.dataset.mesaId);
    if (mesa) modalAccionesMesa(mesa);
  });

  if (esPropietario) {
    container.querySelector('#btn-nueva-mesa')?.addEventListener('click', () => modalMesa());
  }
}

async function cargarMesas() {
  const grid = document.getElementById('grid-mesas');
  if (!grid) return;
  try {
    const mesas = await api('/api/mesas');
    mesasCache = mesas;
    if (mesas.length === 0) {
      grid.innerHTML = '<p class="placeholder">No hay mesas registradas.</p>';
      return;
    }
    // El servidor ordena por zona, número; agrupamos para mostrar un encabezado por zona
    const grupos = new Map();
    for (const m of mesas) {
      const clave = (m.zona || '').trim() || null;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(m);
    }
    grid.innerHTML = [...grupos.entries()].map(([zona, lista]) => `
      ${zona ? `<h3 class="zona-titulo">${escapeHtml(zona)}</h3>` : ''}
      <div class="grid-mesas-zona">
        ${lista.map((m) => {
          const estadoClass = m.estado === 'LIBRE' ? 'mesa-libre' : m.estado === 'OCUPADA' ? 'mesa-ocupada' : 'mesa-cerrada';
          return `
            <div class="tarjeta-mesa ${estadoClass}" data-mesa-id="${m.id}" role="button" tabindex="0">
              <div class="mesa-numero">${escapeHtml(etiquetaMesa(m.numero, m.nombre_cliente, m.zona))}</div>
              <div class="mesa-estado">${m.estado}</div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Menú de acciones al tocar la tarjeta de una mesa
function modalAccionesMesa(mesa) {
  const esPropietario = state.usuario.rol === 'PROPIETARIO';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${escapeHtml(etiquetaMesa(mesa.numero, mesa.nombre_cliente, mesa.zona))}</h2>
      <p>${escapeHtml(mesa.estado)}</p>
      <div class="mesa-acciones-vertical">
        ${mesa.estado === 'LIBRE' ? '<button class="btn btn-primary btn-block" data-accion="abrir">Abrir mesa</button>' : ''}
        ${mesa.estado === 'OCUPADA' ? '<button class="btn btn-primary btn-block" data-accion="cuenta">Ver cuenta</button>' : ''}
        ${esPropietario ? '<button class="btn btn-ghost btn-block" data-accion="editar">Editar mesa</button>' : ''}
        ${esPropietario ? '<button class="btn btn-ghost btn-block text-danger" data-accion="eliminar">Eliminar mesa</button>' : ''}
        <button class="btn btn-ghost btn-block" data-accion="cerrar">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    const accion = btn.dataset.accion;
    overlay.remove();
    if (accion === 'abrir') window.abrirMesa(mesa.id);
    else if (accion === 'cuenta') window.verCuentaMesa(mesa.id);
    else if (accion === 'editar') window.editarMesa(mesa.id, mesa.numero, mesa.nombre_cliente || '', mesa.zona || '');
    else if (accion === 'eliminar') window.eliminarMesa(mesa.id);
  });
}

function modalMesa(id = null, numero = '', nombre_cliente = '', zona = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${id ? 'Editar' : 'Nueva'} mesa</h2>
      <label>Número de mesa *</label>
      <input type="number" id="mesa-numero" value="${numero}" min="1">
      <label>Zona (opcional)</label>
      <input type="text" id="mesa-zona" value="${escapeHtml(zona)}" list="zonas-sugeridas" placeholder="Ej: Terraza, Barra, Segundo piso">
      <datalist id="zonas-sugeridas">
        <option value="Terraza"></option>
        <option value="Barra"></option>
        <option value="Segundo piso"></option>
        <option value="Salón"></option>
      </datalist>
      <label>Nombre del cliente (opcional)</label>
      <input type="text" id="mesa-cliente" value="${escapeHtml(nombre_cliente)}" placeholder="Ej: Familia Rodríguez">
      <div class="error-msg" id="mesa-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="mesa-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="mesa-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#mesa-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#mesa-guardar').addEventListener('click', async () => {
    const num = parseInt(overlay.querySelector('#mesa-numero').value, 10);
    const zonaVal = overlay.querySelector('#mesa-zona').value.trim();
    const cliente = overlay.querySelector('#mesa-cliente').value.trim();
    const errEl = overlay.querySelector('#mesa-error');
    if (!Number.isInteger(num) || num <= 0) { errEl.textContent = 'Número inválido'; return; }
    try {
      const body = { numero: num, zona: zonaVal, nombre_cliente: cliente || null };
      if (id) {
        await api(`/api/mesas/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/api/mesas', { method: 'POST', body: JSON.stringify(body) });
      }
      overlay.remove();
      toast('Mesa guardada', 'success');
      cargarMesas();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

window.abrirMesa = async (id) => {
  try {
    await api(`/api/mesas/${id}/abrir`, { method: 'POST' });
    toast('Mesa abierta', 'success');
    cargarMesas();
    window.dispatchEvent(new Event('mesas-cambio'));
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.editarMesa = (id, numero, nombre_cliente, zona) => modalMesa(id, numero, nombre_cliente, zona);

window.eliminarMesa = async (id) => {
  if (!confirm('¿Eliminar esta mesa?')) return;
  try {
    await api(`/api/mesas/${id}`, { method: 'DELETE' });
    toast('Mesa eliminada', 'success');
    cargarMesas();
    window.dispatchEvent(new Event('mesas-cambio'));
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.verCuentaMesa = async (mesaId) => {
  try {
    const datos = await api(`/api/mesas/${mesaId}/cuenta`);
    modalCuenta(mesaId, datos.mesa);
  } catch (err) {
    toast(err.message, 'error');
  }
};

function modalCuenta(mesaId, mesa) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-grande">
      <h2>Cuenta ${escapeHtml(etiquetaMesa(mesa.numero, mesa.nombre_cliente, mesa.zona))}</h2>
      <div id="cuenta-items" class="lista-cuenta"></div>
      <div class="form-grid">
        <div>
          <label>Buscar producto</label>
          <input type="text" id="cuenta-buscar" placeholder="Escribe el nombre..." autocomplete="off">
          <div id="cuenta-resultados" class="lista-resultados"></div>
        </div>
        <div>
          <label>Cantidad</label>
          <input type="number" id="cuenta-cantidad" min="1" value="1">
        </div>
      </div>
      <button class="btn btn-primary btn-sm" id="cuenta-agregar">Agregar producto</button>
      <div class="cuenta-total">Total: $<span id="cuenta-total">0</span></div>
      <div class="error-msg" id="cuenta-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="cuenta-cerrar">Cerrar</button>
        <button class="btn btn-primary" id="cuenta-cobrar">Cobrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errEl = overlay.querySelector('#cuenta-error');
  let cuentaActual = null;
  let totalActual = 0;
  let productos = [];
  let productoSeleccionado = null;

  async function refrescar() {
    const datos = await api(`/api/mesas/${mesaId}/cuenta`);
    cuentaActual = datos.cuenta;
    totalActual = datos.total;
    const cont = overlay.querySelector('#cuenta-items');
    if (datos.items.length === 0) {
      cont.innerHTML = '<p class="placeholder">Sin productos todavía.</p>';
    } else {
      cont.innerHTML = datos.items.map((i) => `
        <div class="item-cuenta">
          <span class="item-cuenta-nombre">${escapeHtml(i.producto_nombre)}</span>
          <span class="item-cuenta-cantidad">x${i.cantidad}</span>
          <span class="item-cuenta-subtotal">$${i.subtotal.toLocaleString('es-CO')}</span>
          <button class="btn btn-ghost btn-sm text-danger" data-quitar="${i.id}">Quitar</button>
        </div>
      `).join('');
      cont.querySelectorAll('[data-quitar]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/cuentas/${cuentaActual.id}/items/${btn.dataset.quitar}`, { method: 'DELETE' });
            await refrescar();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    }
    overlay.querySelector('#cuenta-total').textContent = datos.total.toLocaleString('es-CO');
    return datos;
  }

  function renderResultados(filtro) {
    const cont = overlay.querySelector('#cuenta-resultados');
    const f = (filtro || '').trim().toLowerCase();
    const lista = (f ? productos.filter((p) => p.nombre.toLowerCase().includes(f)) : productos).slice(0, 30);
    if (lista.length === 0) {
      cont.innerHTML = '<p class="placeholder">Sin resultados</p>';
      return;
    }
    cont.innerHTML = lista.map((p) => `
      <button type="button" class="resultado-producto ${productoSeleccionado === p.id ? 'seleccionado' : ''}" data-id="${p.id}">
        <span class="rp-nombre">${escapeHtml(p.nombre)}</span>
        <span class="rp-info">$${p.precio_venta.toLocaleString('es-CO')} · stock: ${p.stock_actual}</span>
      </button>
    `).join('');
    cont.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        productoSeleccionado = Number(btn.dataset.id);
        const p = productos.find((x) => x.id === productoSeleccionado);
        overlay.querySelector('#cuenta-buscar').value = p.nombre;
        renderResultados(p.nombre);
      });
    });
  }

  async function cargarProductos() {
    productos = await api('/api/productos');
    renderResultados('');
  }

  overlay.querySelector('#cuenta-buscar').addEventListener('input', (e) => {
    productoSeleccionado = null;
    renderResultados(e.target.value);
  });

  refrescar().catch((e) => toast(e.message, 'error'));
  cargarProductos().catch((e) => toast(e.message, 'error'));

  overlay.querySelector('#cuenta-agregar').addEventListener('click', async () => {
    errEl.textContent = '';
    if (!Number.isInteger(productoSeleccionado)) { errEl.textContent = 'Selecciona un producto de la lista'; return; }
    const cantidad = parseInt(overlay.querySelector('#cuenta-cantidad').value, 10);
    if (!Number.isInteger(cantidad) || cantidad <= 0) { errEl.textContent = 'Cantidad inválida'; return; }
    try {
      await api(`/api/cuentas/${cuentaActual.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ producto_id: productoSeleccionado, cantidad }),
      });
      overlay.querySelector('#cuenta-cantidad').value = '1';
      overlay.querySelector('#cuenta-buscar').value = '';
      productoSeleccionado = null;
      renderResultados('');
      await refrescar();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  overlay.querySelector('#cuenta-cerrar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cuenta-cobrar').addEventListener('click', () => modalCobro(cuentaActual, totalActual, mesa, overlay));
}

function modalCobro(cuenta, subtotal, mesa, cuentaOverlay) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Cobrar ${escapeHtml(etiquetaMesa(mesa.numero, mesa.nombre_cliente, mesa.zona))}</h2>
      <div class="form-grid">
        <div>
          <label>Método de pago</label>
          <select id="cobro-metodo">
            <option value="EFECTIVO">Efectivo</option>
            <option value="DATAFONO">Datáfono</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="NEQUI">Nequi</option>
          </select>
        </div>
        <div id="cobro-pago-con-wrap">
          <label>Recibido (efectivo)</label>
          <input type="number" id="cobro-pago-con" min="0" step="1000" value="0">
        </div>
        <div>
          <label>Descuento ($)</label>
          <input type="number" id="cobro-descuento" min="0" step="1000" value="0">
        </div>
        <div>
          <label>Propina ($, aparte)</label>
          <input type="number" id="cobro-propina" min="0" step="1000" value="0">
        </div>
      </div>
      <div class="resumen-cobro">
        <div><span>Subtotal</span><span id="cobro-subtotal">$0</span></div>
        <div><span>Descuento</span><span id="cobro-desc">-$0</span></div>
        <div><span>Propina</span><span id="cobro-prop">+$0</span></div>
        <div class="total-pagar"><span>A pagar</span><span id="cobro-total">$0</span></div>
        <div id="cobro-cambio-linea" class="linea-cambio"><span>Cambio</span><span id="cobro-cambio">$0</span></div>
      </div>
      <div class="error-msg" id="cobro-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="cobro-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="cobro-confirmar">Confirmar cobro</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const pesos = (n) => `$${(n || 0).toLocaleString('es-CO')}`;
  const metodoEl = overlay.querySelector('#cobro-metodo');
  const pagoConEl = overlay.querySelector('#cobro-pago-con');
  const descEl = overlay.querySelector('#cobro-descuento');
  const propEl = overlay.querySelector('#cobro-propina');

  function recalcular() {
    const metodo = metodoEl.value;
    const pagoCon = Math.max(0, parseInt(pagoConEl.value, 10) || 0);
    const desc = Math.max(0, parseInt(descEl.value, 10) || 0);
    const prop = Math.max(0, parseInt(propEl.value, 10) || 0);
    const total = Math.max(0, subtotal - desc);
    const aPagar = total + prop;
    overlay.querySelector('#cobro-subtotal').textContent = pesos(subtotal);
    overlay.querySelector('#cobro-desc').textContent = `-${pesos(desc)}`;
    overlay.querySelector('#cobro-prop').textContent = `+${pesos(prop)}`;
    overlay.querySelector('#cobro-total').textContent = pesos(aPagar);

    const pagoConWrap = overlay.querySelector('#cobro-pago-con-wrap');
    const cambioLinea = overlay.querySelector('#cobro-cambio-linea');
    const esEfectivo = metodo === 'EFECTIVO';
    pagoConWrap.classList.toggle('hidden', !esEfectivo);
    cambioLinea.classList.toggle('hidden', !esEfectivo);
    overlay.querySelector('#cobro-cambio').textContent = pesos(Math.max(0, pagoCon - aPagar));
  }
  metodoEl.addEventListener('change', recalcular);
  pagoConEl.addEventListener('input', recalcular);
  descEl.addEventListener('input', recalcular);
  propEl.addEventListener('input', recalcular);
  recalcular();

  overlay.querySelector('#cobro-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cobro-confirmar').addEventListener('click', async () => {
    const metodo = overlay.querySelector('#cobro-metodo').value;
    const pagoCon = parseInt(overlay.querySelector('#cobro-pago-con').value, 10) || 0;
    const descuento = Math.max(0, parseInt(descEl.value, 10) || 0);
    const propina = Math.max(0, parseInt(propEl.value, 10) || 0);
    const errEl = overlay.querySelector('#cobro-error');
    errEl.textContent = '';
    try {
      const result = await api(`/api/cuentas/${cuenta.id}/cobrar`, {
        method: 'POST',
        body: JSON.stringify({ metodo_pago: metodo, pago_con: pagoCon, descuento, propina }),
      });
      overlay.remove();
      cuentaOverlay.remove();
      toast(`Cobro exitoso. Cambio: $${result.cambio.toLocaleString('es-CO')}`, 'success');
      cargarMesas();
      window.dispatchEvent(new Event('mesas-cambio'));
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
