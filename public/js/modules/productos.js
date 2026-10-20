import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml } from '../ui.js';

export async function renderProductos(container) {
  const esPropietario = state.usuario.rol === 'PROPIETARIO';

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Productos</h2>
      ${esPropietario ? '<button id="btn-nuevo-prod" class="btn btn-primary">Nuevo producto</button>' : ''}
    </div>
    <div class="filtros">
      <input type="search" id="buscar-prod" placeholder="Buscar por nombre..." class="input-buscar">
      <select id="filtro-categoria" class="select-categoria">
        <option value="">Todas las categorías</option>
      </select>
    </div>
    <div id="lista-productos" class="lista-productos"></div>
  `;

  await cargarCategoriasFiltro();
  await cargarProductos();

  let timeout;
  const buscarEl = document.getElementById('buscar-prod');
  const filtroEl = document.getElementById('filtro-categoria');
  if (buscarEl) buscarEl.addEventListener('input', (e) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => cargarProductos(), 300);
  });
  if (filtroEl) filtroEl.addEventListener('change', () => cargarProductos());

  if (esPropietario) {
    const btnNuevo = document.getElementById('btn-nuevo-prod');
    if (btnNuevo) btnNuevo.addEventListener('click', () => modalProducto());
  }
}

async function cargarCategoriasFiltro() {
  try {
    const sel = document.getElementById('filtro-categoria');
    if (!sel) return;
    const cats = await api('/api/categorias');
    if (!sel.isConnected) return;
    cats.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre;
      sel.appendChild(opt);
    });
  } catch { /* si no hay acceso, no se llena */ }
}

async function cargarProductos() {
  const lista = document.getElementById('lista-productos');
  const buscarEl = document.getElementById('buscar-prod');
  const catEl = document.getElementById('filtro-categoria');
  if (!lista || !buscarEl || !catEl) return;
  const buscar = buscarEl.value.trim();
  const categoria = catEl.value;
  let url = '/api/productos?';
  if (buscar) url += `buscar=${encodeURIComponent(buscar)}&`;
  if (categoria) url += `categoria=${categoria}`;
  try {
    const prods = await api(url);
    if (prods.length === 0) {
      lista.innerHTML = '<p class="placeholder">No hay productos.</p>';
      return;
    }
    const esPropietario = state.usuario.rol === 'PROPIETARIO';
    lista.innerHTML = prods.map((p) => {
      const stockClass = p.stock_actual <= p.stock_minimo ? 'stock-bajo' : '';
      const imgSrc = p.imagen_url || '/img/producto-default.svg';
      const precioHtml = esPropietario
        ? `<input type="number" class="input-precio" value="${p.precio_venta}" min="0" step="100"
             onchange="editarPrecio(${p.id}, this.value)" title="Precio de venta">`
        : `<span class="precio">$${p.precio_venta.toLocaleString('es-CO')}</span>`;
      return `
        <div class="item-producto">
          <img src="${imgSrc}" alt="" class="img-producto">
          <div class="info-producto">
            <span class="nombre-producto">${escapeHtml(p.nombre)}</span>
            <span class="categoria-producto">${escapeHtml(p.categoria_nombre || 'Sin categoría')}</span>
          </div>
          <span class="stock ${stockClass}">${p.stock_actual} ${escapeHtml(p.unidad_medida)}</span>
          <span class="precio-col">${precioHtml}</span>
          ${esPropietario ? `
            <span class="acciones-producto">
              <button class="btn btn-ghost btn-sm" onclick="editarProducto(${p.id})">Editar</button>
              <button class="btn btn-ghost btn-sm text-danger" onclick="eliminarProducto(${p.id}, '${escapeHtml(p.nombre).replace(/'/g, "\\'")}')">Eliminar</button>
            </span>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function modalProducto(id = null, datos = {}) {
  const esEdicion = id !== null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-grande">
      <h2>${esEdicion ? 'Editar' : 'Nuevo'} producto</h2>
      <div class="form-grid">
        <div>
          <label>Nombre *</label>
          <input type="text" id="prod-nombre" value="${escapeHtml(datos.nombre || '')}">
        </div>
        <div>
          <label>Categoría</label>
          <select id="prod-categoria">
            <option value="">Sin categoría</option>
          </select>
        </div>
        <div>
          <label>Precio de venta *</label>
          <input type="number" id="prod-precio-venta" value="${datos.precio_venta || ''}" min="1" step="100">
        </div>
        <div>
          <label>Precio de compra</label>
          <input type="number" id="prod-precio-compra" value="${datos.precio_compra || 0}" min="0" step="100">
        </div>
        <div>
          <label>Stock actual</label>
          <input type="number" id="prod-stock" value="${datos.stock_actual ?? 0}" min="0">
        </div>
        <div>
          <label>Stock mínimo</label>
          <input type="number" id="prod-stock-min" value="${datos.stock_minimo ?? 0}" min="0">
        </div>
        <div>
          <label>Unidad de medida</label>
          <input type="text" id="prod-unidad" value="${escapeHtml(datos.unidad_medida || 'unidad')}" placeholder="unidad, botella, paquete...">
        </div>
        <div>
          <label>Imagen</label>
          <input type="file" id="prod-imagen" accept="image/png,image/jpeg,image/webp">
        </div>
      </div>
      <div class="error-msg" id="prod-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="prod-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="prod-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Llenar categorías en el modal
  api('/api/categorias').then((cats) => {
    const sel = overlay.querySelector('#prod-categoria');
    cats.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre;
      if (datos.categoria_id === c.id) opt.selected = true;
      sel.appendChild(opt);
    });
  });

  overlay.querySelector('#prod-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#prod-guardar').addEventListener('click', async () => {
    const errEl = overlay.querySelector('#prod-error');
    errEl.textContent = '';
    const body = {
      nombre: overlay.querySelector('#prod-nombre').value.trim(),
      categoria_id: overlay.querySelector('#prod-categoria').value || null,
      precio_venta: parseInt(overlay.querySelector('#prod-precio-venta').value, 10),
      precio_compra: parseInt(overlay.querySelector('#prod-precio-compra').value, 10) || 0,
      stock_actual: parseInt(overlay.querySelector('#prod-stock').value, 10) || 0,
      stock_minimo: parseInt(overlay.querySelector('#prod-stock-min').value, 10) || 0,
      unidad_medida: overlay.querySelector('#prod-unidad').value.trim() || 'unidad',
    };
    // Imagen a base64 si se seleccionó una
    const fileInput = overlay.querySelector('#prod-imagen');
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      if (file.size > 2 * 1024 * 1024) {
        errEl.textContent = 'La imagen no puede superar 2 MB';
        return;
      }
      body.imagen_base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    }
    try {
      if (esEdicion) {
        await api(`/api/productos/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/api/productos', { method: 'POST', body: JSON.stringify(body) });
      }
      overlay.remove();
      toast('Producto guardado', 'success');
      cargarProductos();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

window.editarPrecio = async (id, valor) => {
  const precio = parseInt(valor, 10);
  if (!Number.isInteger(precio) || precio <= 0) {
    toast('Precio inválido', 'error');
    cargarProductos();
    return;
  }
  try {
    await api(`/api/productos/${id}`, { method: 'PUT', body: JSON.stringify({ precio_venta: precio }) });
    toast('Precio actualizado', 'success');
  } catch (err) {
    toast(err.message, 'error');
    cargarProductos();
  }
};

window.editarProducto = async (id) => {
  try {
    const p = await api(`/api/productos?id=${id}`);
    // Buscar en la lista completa
    const prods = await api('/api/productos');
    const datos = prods.find((x) => x.id === id);
    if (datos) modalProducto(id, datos);
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.eliminarProducto = async (id, nombre) => {
  if (!confirm(`¿Eliminar "${nombre}"? El producto se desactivará (no se borra).`)) return;
  try {
    await api(`/api/productos/${id}`, { method: 'DELETE' });
    toast('Producto eliminado', 'success');
    cargarProductos();
  } catch (err) {
    toast(err.message, 'error');
  }
};
