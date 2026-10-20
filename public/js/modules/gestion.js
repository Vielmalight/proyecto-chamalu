import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml } from '../ui.js';
import { abrirRecortador } from './recortador.js';

const pesos = (n) => `$${(n || 0).toLocaleString('es-CO')}`;

export async function renderGestion(container) {
  const esPropietario = state.usuario.rol === 'PROPIETARIO';

  const S = {
    productos: [],
    categorias: [],
    filtroCat: '',
    buscar: '',
  };

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Gestión</h2>
      <div class="modulo-acciones">
        ${esPropietario ? '<button class="btn btn-ghost" id="gest-cats">Administrar categorías</button>' : ''}
        ${esPropietario ? '<button class="btn btn-primary" id="gest-nuevo">Nuevo producto</button>' : ''}
      </div>
    </div>
    <div class="filtros">
      <input type="search" id="gest-buscar" class="input-buscar" placeholder="Buscar por nombre...">
    </div>
    <div id="gest-chips" class="chips"></div>
    <div id="gest-grid" class="grid-productos"></div>
  `;

  const $ = (id) => document.getElementById(id);

  async function cargarCategorias() {
    try {
      S.categorias = await api('/api/categorias');
    } catch {
      S.categorias = [];
    }
  }

  async function cargarProductos() {
    try {
      let url = '/api/productos?';
      if (S.buscar) url += `buscar=${encodeURIComponent(S.buscar)}&`;
      if (S.filtroCat) url += `categoria=${S.filtroCat}`;
      S.productos = await api(url);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderChips() {
    const cont = $('gest-chips');
    if (!cont) return;
    // Siempre por id de categoría: el servidor filtra por categoria_id
    const chip = (id, nombre) =>
      `<button class="chip ${String(S.filtroCat) === String(id) ? 'chip-activo' : ''}" data-cat="${escapeHtml(String(id))}">${escapeHtml(nombre)}</button>`;
    cont.innerHTML = chip('', 'Todas') + S.categorias.map((c) => chip(c.id, c.nombre)).join('');
  }

  function renderGrid() {
    const cont = $('gest-grid');
    if (!cont) return;
    if (S.productos.length === 0) {
      cont.innerHTML = '<p class="placeholder">No hay productos.</p>';
      return;
    }
    cont.innerHTML = S.productos.map((p) => {
      const sinStock = p.stock_actual <= 0;
      const bajo = p.stock_actual <= p.stock_minimo;
      const precioCompra = esPropietario && p.precio_compra != null
        ? `<span class="gp-costo">Costo: ${pesos(p.precio_compra)}</span>` : '';
      const acciones = esPropietario ? `
        <div class="gp-acciones">
          <button class="btn btn-ghost btn-sm" data-accion="editar" data-id="${p.id}">Editar</button>
          <button class="btn btn-ghost btn-sm text-danger" data-accion="eliminar" data-id="${p.id}">Eliminar</button>
        </div>` : '';
      return `
        <div class="grid-prod-card">
          <img src="${p.imagen_url || '/img/producto-default.svg'}" alt="" class="gp-img" data-accion="kardex" data-id="${p.id}">
          <div class="gp-info" data-accion="kardex" data-id="${p.id}">
            <span class="gp-nombre">${escapeHtml(p.nombre)}</span>
            <span class="gp-cat">${escapeHtml(p.categoria_nombre || 'Sin categoría')}</span>
          </div>
          <div class="gp-stockline">
            <span class="gp-stock ${bajo ? 'stock-bajo' : ''} ${sinStock ? 'sin-stock' : ''}">${p.stock_actual} ${escapeHtml(p.unidad_medida)}</span>
            <span class="gp-precio">${pesos(p.precio_venta)}</span>
          </div>
          ${precioCompra}
          <div class="gp-acciones">
            <button class="btn btn-ghost btn-sm" data-accion="kardex" data-id="${p.id}">Ver detalle</button>
            ${acciones}
          </div>
        </div>
      `;
    }).join('');
  }

  async function refrescar() {
    await Promise.all([cargarCategorias(), cargarProductos()]);
    renderChips();
    renderGrid();
  }

  // ---------- Modal producto ----------
  async function modalProducto(id = null) {
    let datos = {};
    if (id) {
      try {
        datos = S.productos.find((p) => p.id === id) || await api(`/api/productos?id=${id}`);
      } catch { datos = {}; }
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-grande">
        <h2>${id ? 'Editar' : 'Nuevo'} producto</h2>
        <div class="form-grid">
          <div><label>Nombre *</label><input type="text" id="prod-nombre" value="${escapeHtml(datos.nombre || '')}"></div>
          <div><label>Categoría</label><select id="prod-categoria"><option value="">Sin categoría</option></select></div>
          <div><label>Precio de venta *</label><input type="number" id="prod-precio-venta" value="${datos.precio_venta || ''}" min="1" step="100"></div>
          <div><label>Precio de compra</label><input type="number" id="prod-precio-compra" value="${datos.precio_compra || 0}" min="0" step="100"></div>
          <div><label>Stock actual</label><input type="number" id="prod-stock" value="${datos.stock_actual ?? 0}" min="0"></div>
          <div><label>Stock mínimo</label><input type="number" id="prod-stock-min" value="${datos.stock_minimo ?? 0}" min="0"></div>
          <div><label>Unidad de medida</label><input type="text" id="prod-unidad" value="${escapeHtml(datos.unidad_medida || 'unidad')}"></div>
          <div class="form-full">
            <label>Imagen</label>
            <div class="zona-imagen" id="prod-imagen-zona" tabindex="0" role="button" aria-label="Elegir imagen del producto">
              <img id="prod-imagen-preview" class="zona-imagen-preview" src="${datos.imagen_url || '/img/producto-default.svg'}" alt="Vista previa">
              <div class="zona-imagen-texto">
                <span>Haz clic o arrastra una imagen aquí</span>
                <span class="zona-imagen-ayuda">PNG, JPG o WEBP (máx. 2 MB)</span>
              </div>
              <input type="file" id="prod-imagen" accept="image/png,image/jpeg,image/webp" class="input-archivo-oculto">
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="prod-recortar" hidden>Recortar imagen</button>
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

    try {
      const cats = await api('/api/categorias');
      if (!overlay.isConnected) return;
      const sel = overlay.querySelector('#prod-categoria');
      cats.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.nombre;
        if (datos.categoria_id === c.id) opt.selected = true;
        sel.appendChild(opt);
      });
    } catch { /* sin acceso */ }

    overlay.querySelector('#prod-cancelar').addEventListener('click', () => overlay.remove());

    // ---------- Zona de imagen: clic o arrastrar y soltar (Fase G) ----------
    let imagenBase64 = null;
    const zona = overlay.querySelector('#prod-imagen-zona');
    const preview = overlay.querySelector('#prod-imagen-preview');
    const fileInput = overlay.querySelector('#prod-imagen');
    const btnRecortar = overlay.querySelector('#prod-recortar');
    // Al editar un producto con imagen subida, se puede reajustar la imagen actual
    btnRecortar.hidden = !(id && datos.imagen_url);
    const errImg = () => overlay.querySelector('#prod-error');

    // Lo que sale del recortador es la imagen final del producto (Fase G3)
    function aplicarRecorte(dataUrl) {
      imagenBase64 = dataUrl;
      preview.src = dataUrl;
      btnRecortar.hidden = false;
    }

    async function previsualizar(file) {
      if (!file) return;
      if (!file.type.startsWith('image/')) { errImg().textContent = 'El archivo debe ser una imagen'; return; }
      if (file.size > 2 * 1024 * 1024) { errImg().textContent = 'La imagen no puede superar 2 MB'; return; }
      errImg().textContent = '';
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      abrirRecortador(dataUrl, aplicarRecorte);
    }

    zona.addEventListener('click', () => fileInput.click());
    zona.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) previsualizar(fileInput.files[0]);
      fileInput.value = ''; // permite volver a elegir el mismo archivo tras cancelar
    });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastrando'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
    zona.addEventListener('drop', (e) => {
      e.preventDefault();
      zona.classList.remove('arrastrando');
      if (e.dataTransfer.files.length > 0) previsualizar(e.dataTransfer.files[0]);
    });

    // Reabrir el recortador sobre la imagen elegida (o la actual del producto al editar)
    btnRecortar.addEventListener('click', () => {
      const actual = imagenBase64 || preview.src;
      if (!actual) return;
      abrirRecortador(actual, aplicarRecorte);
    });

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
      if (imagenBase64) body.imagen_base64 = imagenBase64;
      try {
        if (id) await api(`/api/productos/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/api/productos', { method: 'POST', body: JSON.stringify(body) });
        overlay.remove();
        toast('Producto guardado', 'success');
        refrescar();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  // ---------- Modal categorías ----------
  async function modalCategorias() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Categorías</h2>
        <div id="cats-lista" class="lista-categorias"></div>
        <div class="cats-nueva">
          <input type="text" id="cats-nombre" placeholder="Nueva categoría">
          <button class="btn btn-primary btn-sm" id="cats-agregar">Agregar</button>
        </div>
        <div class="error-msg" id="cats-error"></div>
        <div class="modal-acciones">
          <button class="btn btn-ghost" id="cats-cerrar">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    async function pintar() {
      const cont = overlay.querySelector('#cats-lista');
      if (!cont) return;
      try {
        const cats = await api('/api/categorias');
        if (!overlay.isConnected) return;
        cont.innerHTML = cats.length === 0
          ? '<p class="placeholder">No hay categorías.</p>'
          : cats.map((c) => `
            <div class="item-categoria">
              <span class="item-nombre">${escapeHtml(c.nombre)}</span>
              <span class="item-acciones">
                <button class="btn btn-ghost btn-sm" data-cat-accion="editar" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}">Editar</button>
                <button class="btn btn-ghost btn-sm text-danger" data-cat-accion="eliminar" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}">Eliminar</button>
              </span>
            </div>`).join('');
      } catch (err) {
        cont.innerHTML = `<p class="placeholder">${escapeHtml(err.message)}</p>`;
      }
    }

    overlay.querySelector('#cats-agregar').addEventListener('click', async () => {
      const errEl = overlay.querySelector('#cats-error');
      errEl.textContent = '';
      const nombre = overlay.querySelector('#cats-nombre').value.trim();
      if (!nombre) { errEl.textContent = 'Escribe un nombre'; return; }
      try {
        await api('/api/categorias', { method: 'POST', body: JSON.stringify({ nombre }) });
        overlay.querySelector('#cats-nombre').value = '';
        await pintar();
        refrescar();
      } catch (err) { errEl.textContent = err.message; }
    });

    overlay.querySelector('#cats-lista').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-cat-accion]');
      if (!btn) return;
      const id = btn.dataset.id;
      const nombre = btn.dataset.nombre;
      if (btn.dataset.catAccion === 'editar') {
        const nuevo = prompt('Nuevo nombre de la categoría:', nombre);
        if (!nuevo || !nuevo.trim()) return;
        try {
          await api(`/api/categorias/${id}`, { method: 'PUT', body: JSON.stringify({ nombre: nuevo.trim() }) });
          await pintar();
          refrescar();
        } catch (err) { toast(err.message, 'error'); }
      } else {
        if (!confirm(`¿Eliminar la categoría "${nombre}"?`)) return;
        try {
          await api(`/api/categorias/${id}`, { method: 'DELETE' });
          await pintar();
          refrescar();
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    overlay.querySelector('#cats-cerrar').addEventListener('click', () => overlay.remove());
    pintar();
  }

  // ---------- Modal kardex ----------
  async function modalKardex(id) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-grande">
        <h2 id="kardex-titulo">Detalle de producto</h2>
        <div id="kardex-resumen" class="kardex-resumen"></div>
        ${esPropietario ? `
        <div class="kardex-acciones">
          <button class="btn btn-ghost btn-sm" id="kardex-entrada">+ Entrada</button>
          <button class="btn btn-ghost btn-sm" id="kardex-salida">− Salida</button>
          <button class="btn btn-ghost btn-sm" id="kardex-editar">Editar producto</button>
        </div>` : ''}
        <h4 class="fact-sub">Movimientos</h4>
        <div id="kardex-movs" class="kardex-movs"></div>
        <div class="modal-acciones">
          <button class="btn btn-ghost" id="kardex-cerrar">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    async function pintar() {
      try {
        const prod = (await api('/api/productos')).find((p) => p.id === id);
        if (!overlay.isConnected) return;
        const movs = await api(`/api/inventario/movimientos?producto_id=${id}`);
        if (!overlay.isConnected) return;
        overlay.querySelector('#kardex-titulo').textContent = prod ? prod.nombre : 'Producto';
        overlay.querySelector('#kardex-resumen').innerHTML = prod ? `
          <div><span>Stock actual</span><b>${prod.stock_actual} ${escapeHtml(prod.unidad_medida)}</b></div>
          <div><span>Stock mínimo</span><b>${prod.stock_minimo}</b></div>
          <div><span>Precio de venta</span><b>${pesos(prod.precio_venta)}</b></div>
          ${esPropietario ? `<div><span>Precio de compra</span><b>${pesos(prod.precio_compra)}</b></div>` : ''}
        ` : '<p class="placeholder">Producto no encontrado.</p>';
        overlay.querySelector('#kardex-movs').innerHTML = movs.length === 0
          ? '<p class="placeholder">Sin movimientos registrados.</p>'
          : `<table class="tabla-movs">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Cant.</th><th>Stock</th><th>Motivo</th><th>Usuario</th></tr></thead>
              <tbody>${movs.map((m) => `
                <tr>
                  <td>${escapeHtml(m.fecha)}</td>
                  <td><span class="tag-mov tag-${m.tipo.toLowerCase()}">${m.tipo}</span></td>
                  <td>${m.cantidad}</td>
                  <td>${m.stock_anterior} → ${m.stock_nuevo}</td>
                  <td>${escapeHtml(m.motivo || '')}</td>
                  <td>${escapeHtml(m.usuario_nombre || '')}</td>
                </tr>`).join('')}</tbody>
            </table>`;
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function movimiento(tipo) {
      const label = tipo === 'ENTRADA' ? 'entrada' : 'salida';
      const cantStr = prompt(`Cantidad de ${label}:`);
      if (cantStr === null) return;
      const cantidad = parseInt(cantStr, 10);
      if (!Number.isInteger(cantidad) || cantidad <= 0) { toast('Cantidad inválida', 'error'); return; }
      const motivo = prompt(tipo === 'ENTRADA' ? 'Motivo (compra, ajuste...)' : 'Motivo (obligatorio: daño, consumo...)');
      if (tipo === 'SALIDA' && (!motivo || !motivo.trim())) { toast('El motivo es obligatorio', 'error'); return; }
      try {
        await api(`/api/inventario/${label}`, {
          method: 'POST',
          body: JSON.stringify({ producto_id: id, cantidad, motivo: motivo || '' }),
        });
        toast('Inventario actualizado', 'success');
        await pintar();
        refrescar();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    overlay.querySelector('#kardex-entrada')?.addEventListener('click', () => movimiento('ENTRADA'));
    overlay.querySelector('#kardex-salida')?.addEventListener('click', () => movimiento('SALIDA'));
    overlay.querySelector('#kardex-editar')?.addEventListener('click', () => { overlay.remove(); modalProducto(id); });
    overlay.querySelector('#kardex-cerrar').addEventListener('click', () => overlay.remove());
    pintar();
  }

  // ---------- Eventos ----------
  let debounce = null;
  $('gest-buscar')?.addEventListener('input', (e) => {
    clearTimeout(debounce);
    const valor = e.target.value;
    debounce = setTimeout(async () => {
      S.buscar = valor.trim();
      await cargarProductos();
      renderGrid();
    }, 300);
  });

  $('gest-chips')?.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    S.filtroCat = chip.dataset.cat;
    renderChips();
    await cargarProductos();
    renderGrid();
  });

  $('gest-grid')?.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-accion]');
    if (!el) return;
    const id = Number(el.dataset.id);
    const accion = el.dataset.accion;
    if (accion === 'kardex') modalKardex(id);
    else if (accion === 'editar') modalProducto(id);
    else if (accion === 'eliminar') {
      const prod = S.productos.find((p) => p.id === id);
      if (!confirm(`¿Eliminar "${prod?.nombre || ''}"? El producto se desactivará (no se borra).`)) return;
      try {
        await api(`/api/productos/${id}`, { method: 'DELETE' });
        toast('Producto eliminado', 'success');
        refrescar();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  $('gest-nuevo')?.addEventListener('click', () => modalProducto());
  $('gest-cats')?.addEventListener('click', modalCategorias);

  await refrescar();
}
