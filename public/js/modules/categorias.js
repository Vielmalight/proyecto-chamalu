import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml } from '../ui.js';

export async function renderCategorias(container) {
  container.innerHTML = `
    <div class="modulo-header">
      <h2>Categorías</h2>
      <button id="btn-nueva-cat" class="btn btn-primary">Nueva categoría</button>
    </div>
    <div id="lista-categorias" class="lista-categorias"></div>
  `;

  await cargarCategorias();

  document.getElementById('btn-nueva-cat')?.addEventListener('click', () => modalCategoria());
}

async function cargarCategorias() {
  const lista = document.getElementById('lista-categorias');
  if (!lista) return;
  try {
    const cats = await api('/api/categorias');
    if (cats.length === 0) {
      lista.innerHTML = '<p class="placeholder">No hay categorías.</p>';
      return;
    }
    lista.innerHTML = cats.map((c) => `
      <div class="item-categoria">
        <span class="item-nombre">${escapeHtml(c.nombre)}</span>
        <span class="item-acciones">
          <button class="btn btn-ghost btn-sm" onclick="editarCategoria(${c.id}, '${escapeHtml(c.nombre).replace(/'/g, "\\'")}', '${escapeHtml(c.descripcion || '').replace(/'/g, "\\'")}')">Editar</button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="eliminarCategoria(${c.id}, '${escapeHtml(c.nombre).replace(/'/g, "\\'")}')">Eliminar</button>
        </span>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function modalCategoria(id = null, nombre = '', descripcion = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${id ? 'Editar' : 'Nueva'} categoría</h2>
      <label>Nombre</label>
      <input type="text" id="cat-nombre" value="${escapeHtml(nombre)}">
      <label>Descripción (opcional)</label>
      <input type="text" id="cat-descripcion" value="${escapeHtml(descripcion)}">
      <div class="error-msg" id="cat-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="cat-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="cat-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cat-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cat-guardar').addEventListener('click', async () => {
    const nom = overlay.querySelector('#cat-nombre').value.trim();
    const desc = overlay.querySelector('#cat-descripcion').value.trim();
    const errEl = overlay.querySelector('#cat-error');
    if (!nom) { errEl.textContent = 'El nombre es obligatorio'; return; }
    try {
      if (id) {
        await api(`/api/categorias/${id}`, { method: 'PUT', body: JSON.stringify({ nombre: nom, descripcion: desc }) });
      } else {
        await api('/api/categorias', { method: 'POST', body: JSON.stringify({ nombre: nom, descripcion: desc }) });
      }
      overlay.remove();
      toast('Categoría guardada', 'success');
      cargarCategorias();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

window.editarCategoria = (id, nombre, descripcion) => modalCategoria(id, nombre, descripcion);
window.eliminarCategoria = async (id, nombre) => {
  if (!confirm(`¿Eliminar la categoría "${nombre}"?`)) return;
  try {
    await api(`/api/categorias/${id}`, { method: 'DELETE' });
    toast('Categoría eliminada', 'success');
    cargarCategorias();
  } catch (err) {
    toast(err.message, 'error');
  }
};
