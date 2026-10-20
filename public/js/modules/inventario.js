import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml } from '../ui.js';

export async function renderInventario(container) {
  const esPropietario = state.usuario.rol === 'PROPIETARIO';

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Inventario</h2>
    </div>
    <div class="filtros">
      <select id="filtro-tipo" class="select-categoria">
        <option value="">Todos los tipos</option>
        <option value="ENTRADA">Entradas</option>
        <option value="SALIDA">Salidas</option>
      </select>
    </div>
    <div id="lista-movimientos" class="lista-movimientos"></div>
    ${esPropietario ? `
      <div class="acciones-inventario">
        <button id="btn-entrada" class="btn btn-primary">Registrar entrada</button>
        <button id="btn-salida" class="btn btn-ghost">Registrar salida</button>
      </div>
    ` : ''}
  `;

  await cargarMovimientos();

  container.querySelector('#filtro-tipo')?.addEventListener('change', cargarMovimientos);

  if (esPropietario) {
    container.querySelector('#btn-entrada')?.addEventListener('click', () => modalMovimiento('ENTRADA'));
    container.querySelector('#btn-salida')?.addEventListener('click', () => modalMovimiento('SALIDA'));
  }
}

async function cargarMovimientos() {
  const lista = document.getElementById('lista-movimientos');
  const filtro = document.getElementById('filtro-tipo');
  if (!lista || !filtro) return;
  const tipo = filtro.value;
  let url = '/api/inventario/movimientos?';
  if (tipo) url += `tipo=${tipo}`;
  try {
    const movimientos = await api(url);
    if (movimientos.length === 0) {
      lista.innerHTML = '<p class="placeholder">No hay movimientos.</p>';
      return;
    }
    lista.innerHTML = movimientos.map((m) => {
      const tipoClass = m.tipo === 'ENTRADA' ? 'movimiento-entrada' : 'movimiento-salida';
      return `
        <div class="item-movimiento ${tipoClass}">
          <div class="movimiento-info">
            <span class="movimiento-producto">${escapeHtml(m.producto_nombre)}</span>
            <span class="movimiento-tipo">${m.tipo}</span>
            <span class="movimiento-cantidad">${m.tipo === 'ENTRADA' ? '+' : '-'}${m.cantidad}</span>
          </div>
          <span class="movimiento-fecha">${m.fecha}</span>
          <span class="movimiento-motivo">${escapeHtml(m.motivo || '')}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function modalMovimiento(tipo) {
  const esEntrada = tipo === 'ENTRADA';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${esEntrada ? 'Registrar entrada' : 'Registrar salida'}</h2>
      <label>Producto</label>
      <select id="mov-producto"></select>
      <label>Cantidad</label>
      <input type="number" id="mov-cantidad" min="1" value="1">
      <label>Motivo</label>
      <input type="text" id="mov-motivo" placeholder="${esEntrada ? 'Compra al proveedor' : 'Daño, merma, consumo...'}">
      <div class="error-msg" id="mov-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="mov-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="mov-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Cargar productos
  api('/api/productos').then((prods) => {
    const sel = overlay.querySelector('#mov-producto');
    prods.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.nombre} (stock: ${p.stock_actual})`;
      sel.appendChild(opt);
    });
  });

  overlay.querySelector('#mov-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#mov-guardar').addEventListener('click', async () => {
    const producto_id = parseInt(overlay.querySelector('#mov-producto').value, 10);
    const cantidad = parseInt(overlay.querySelector('#mov-cantidad').value, 10);
    const motivo = overlay.querySelector('#mov-motivo').value.trim();
    const errEl = overlay.querySelector('#mov-error');
    if (!Number.isInteger(cantidad) || cantidad <= 0) { errEl.textContent = 'Cantidad inválida'; return; }
    if (!esEntrada && !motivo) { errEl.textContent = 'El motivo es obligatorio para salidas'; return; }
    try {
      await api(`/api/inventario/${esEntrada ? 'entrada' : 'salida'}`, {
        method: 'POST',
        body: JSON.stringify({ producto_id, cantidad, motivo }),
      });
      overlay.remove();
      toast('Movimiento registrado', 'success');
      cargarMovimientos();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
