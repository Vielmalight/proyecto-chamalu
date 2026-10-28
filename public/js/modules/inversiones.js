import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml, aplicarFormatoMiles, limpiarMiles } from '../ui.js';

const pesos = (n) => `$${(n || 0).toLocaleString('es-CO')}`;

export async function renderInversiones(container) {
  const esPropietario = state.usuario?.rol === 'PROPIETARIO';
  if (!esPropietario) {
    container.innerHTML = `<div class="modulo-header"><h2>Inversiones</h2></div><p class="placeholder">Solo disponible para el propietario.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Inversiones</h2>
      <button class="btn btn-primary" id="inv-nueva">Nueva inversión</button>
    </div>
    <div id="inv-lista" class="lista-inversiones"></div>
  `;

  async function cargar() {
    const lista = document.getElementById('inv-lista');
    if (!lista) return;
    try {
      const datos = await api('/api/inversiones');
      if (datos.length === 0) {
        lista.innerHTML = '<p class="placeholder">No hay inversiones registradas.</p>';
        return;
      }
      lista.innerHTML = `
        <table class="tabla-reporte">
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Origen</th><th class="num">Monto</th><th></th></tr></thead>
          <tbody>
            ${datos.map((inv) => `
              <tr>
                <td>${escapeHtml(inv.fecha)}</td>
                <td>${escapeHtml(inv.descripcion)}</td>
                <td>${inv.origen === 'CAJA' ? 'Caja' : 'Bolsillo'}</td>
                <td class="num">${pesos(inv.monto)}</td>
                <td><button class="btn btn-ghost btn-sm text-danger" data-id="${inv.id}">Eliminar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      lista.querySelectorAll('button[data-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar esta inversión?')) return;
          try {
            await api(`/api/inversiones/${btn.dataset.id}`, { method: 'DELETE' });
            toast('Inversión eliminada', 'success');
            cargar();
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  document.getElementById('inv-nueva')?.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Nueva inversión</h2>
        <label>Fecha</label>
        <input type="date" id="inv-fecha" value="${new Date().toISOString().slice(0,10)}">
        <label>Descripción</label>
        <input type="text" id="inv-desc">
        <label>Monto</label>
        <input type="text" inputmode="numeric" id="inv-monto" placeholder="0">
        <label>Origen del dinero</label>
        <select id="inv-origen">
          <option value="CAJA">Caja (sale de caja chica)</option>
          <option value="BOLSILLO">Bolsillo (solo registro)</option>
        </select>
        <div class="error-msg" id="inv-error"></div>
        <div class="modal-acciones">
          <button class="btn btn-ghost" id="inv-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="inv-guardar">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const invMonto = overlay.querySelector('#inv-monto');
    aplicarFormatoMiles(invMonto);
    overlay.querySelector('#inv-cancelar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#inv-guardar').addEventListener('click', async () => {
      const errEl = overlay.querySelector('#inv-error');
      errEl.textContent = '';
      const monto = limpiarMiles(invMonto.value);
      try {
        await api('/api/inversiones', {
          method: 'POST',
          body: JSON.stringify({
            fecha: overlay.querySelector('#inv-fecha').value,
            descripcion: overlay.querySelector('#inv-desc').value,
            monto,
            origen: overlay.querySelector('#inv-origen').value,
          }),
        });
        overlay.remove();
        toast('Inversión registrada', 'success');
        cargar();
      } catch (err) { errEl.textContent = err.message; }
    });
  });

  cargar();
}
