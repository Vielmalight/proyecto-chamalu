import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml, aplicarFormatoMiles, limpiarMiles } from '../ui.js';

const NOMBRE_METODO = {
  EFECTIVO: 'Efectivo',
  DATAFONO: 'Datáfono',
  TRANSFERENCIA: 'Transferencia',
  NEQUI: 'Nequi',
};

const pesos = (n) => `$${(n || 0).toLocaleString('es-CO')}`;

export async function renderCaja(container) {
  const esPropietario = state.usuario.rol === 'PROPIETARIO';

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Caja</h2>
    </div>
    <div id="resumen-caja" class="resumen-caja"></div>
    <div class="acciones-caja">
      <button id="btn-cierre" class="btn btn-primary">Cerrar turno</button>
      ${esPropietario ? '<button id="btn-editar-apertura" class="btn btn-ghost">Editar apertura</button>' : ''}
    </div>
    <h3>Caja chica</h3>
    <div class="filtros">
      <button id="btn-caja-chica-entrada" class="btn btn-primary btn-sm">Entrada</button>
      <button id="btn-caja-chica-salida" class="btn btn-ghost btn-sm">Salida</button>
    </div>
    <div id="lista-caja-chica" class="lista-caja-chica"></div>
    ${esPropietario ? `
      <h3>Gastos</h3>
      <button id="btn-nuevo-gasto" class="btn btn-primary btn-sm">Nuevo gasto</button>
      <div id="lista-gastos" class="lista-gastos"></div>
      <h3>Historial de turnos cerrados</h3>
      <div id="lista-turnos" class="lista-turnos"></div>
    ` : ''}
  `;

  await cargarResumen();
  await cargarCajaChica();
  if (esPropietario) {
    await cargarGastos();
    await cargarHistorialTurnos();
  }

  container.querySelector('#btn-cierre')?.addEventListener('click', modalCierre);
  container.querySelector('#btn-caja-chica-entrada')?.addEventListener('click', () => modalCajaChica('ENTRADA'));
  container.querySelector('#btn-caja-chica-salida')?.addEventListener('click', () => modalCajaChica('SALIDA'));
  if (esPropietario) {
    container.querySelector('#btn-editar-apertura')?.addEventListener('click', modalEditarApertura);
  }
  if (esPropietario) {
    container.querySelector('#btn-nuevo-gasto')?.addEventListener('click', modalGasto);
  }
}

async function cargarResumen() {
  const div = document.getElementById('resumen-caja');
  if (!div) return;
  try {
    const datos = await api('/api/caja/resumen');
    if (!datos.turno) {
      div.innerHTML = '<p class="placeholder">No hay un turno de caja abierto.</p>';
      return;
    }
    div.innerHTML = `
      <div class="tarjeta-resumen">
        <div class="resumen-item">
          <span class="resumen-label">Apertura (caja mayor)</span>
          <span class="resumen-valor">$${datos.turno.monto_apertura.toLocaleString('es-CO')}</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">Ventas del turno</span>
          <span class="resumen-valor">$${datos.ventas_total.toLocaleString('es-CO')}</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">Cantidad de ventas</span>
          <span class="resumen-valor">${datos.ventas_cantidad}</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">Caja chica</span>
          <span class="resumen-valor">$${datos.caja_chica_saldo.toLocaleString('es-CO')}</span>
        </div>
      </div>
      <div class="desglose-metodos">
        <h3>Ventas por método de pago</h3>
        <table class="tabla-reporte">
          <thead><tr><th>Método</th><th class="num">Ventas</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${datos.por_metodo.length === 0
              ? '<tr><td colspan="3">Sin ventas todavía.</td></tr>'
              : datos.por_metodo.map((m) => `
                  <tr>
                    <td>${escapeHtml(NOMBRE_METODO[m.metodo_pago] || m.metodo_pago)}</td>
                    <td class="num">${m.cantidad}</td>
                    <td class="num">$${m.total.toLocaleString('es-CO')}</td>
                  </tr>`).join('')}
            <tr class="fila-total">
              <td>Total general</td>
              <td class="num">${datos.ventas_cantidad}</td>
              <td class="num">$${datos.ventas_total.toLocaleString('es-CO')}</td>
            </tr>
          </tbody>
        </table>
        <div class="resumen-item resumen-destacado">
          <span class="resumen-label">Efectivo esperado en caja</span>
          <span class="resumen-valor">$${datos.efectivo_esperado.toLocaleString('es-CO')}</span>
        </div>
      </div>
    `;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cargarCajaChica() {
  const lista = document.getElementById('lista-caja-chica');
  if (!lista) return;
  try {
    const datos = await api('/api/caja/chica');
    if (!datos.turno) {
      lista.innerHTML = '<p class="placeholder">No hay turno abierto.</p>';
      return;
    }
    if (datos.movimientos.length === 0) {
      lista.innerHTML = '<p class="placeholder">Sin movimientos en este turno.</p>';
      return;
    }
    lista.innerHTML = datos.movimientos.map((m) => `
      <div class="item-movimiento ${m.tipo === 'ENTRADA' ? 'movimiento-entrada' : 'movimiento-salida'}">
        <span class="movimiento-tipo">${m.tipo}</span>
        <span class="movimiento-motivo">${escapeHtml(m.descripcion || '')}</span>
        <span class="movimiento-cantidad">$${m.monto.toLocaleString('es-CO')}</span>
        <span class="movimiento-fecha">${escapeHtml(m.fecha)}</span>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cargarGastos() {
  const lista = document.getElementById('lista-gastos');
  if (!lista) return;
  try {
    const gastos = await api('/api/gastos');
    if (gastos.length === 0) {
      lista.innerHTML = '<p class="placeholder">No hay gastos registrados.</p>';
      return;
    }
    lista.innerHTML = gastos.map((g) => `
      <div class="item-gasto">
        <span class="gasto-descripcion">${escapeHtml(g.descripcion)}</span>
        <span class="gasto-categoria">${escapeHtml(g.categoria)}</span>
        <span class="gasto-monto">$${g.monto.toLocaleString('es-CO')}</span>
        <button class="btn btn-ghost btn-sm text-danger" onclick="eliminarGasto(${g.id})">Eliminar</button>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cargarHistorialTurnos() {
  const cont = document.getElementById('lista-turnos');
  if (!cont) return;
  try {
    const turnos = await api('/api/caja/turnos');
    if (turnos.length === 0) {
      cont.innerHTML = '<p class="placeholder">Todavía no hay turnos cerrados.</p>';
      return;
    }
    cont.innerHTML = `
      <table class="tabla-reporte">
        <thead><tr>
          <th>Usuario</th><th>Cierre</th><th class="num">Apertura</th>
          <th class="num">Esperado</th><th class="num">Declarado</th><th class="num">Diferencia</th>
        </tr></thead>
        <tbody>
          ${turnos.map((t) => {
            const dif = t.diferencia || 0;
            const esperado = (t.monto_cierre_declarado || 0) - dif;
            const claseDif = dif === 0 ? '' : dif > 0 ? 'var-up' : 'var-down';
            const textoDif = dif === 0 ? 'cuadra' : dif > 0 ? `+${pesos(dif)}` : `-${pesos(Math.abs(dif))}`;
            return `<tr>
              <td>${escapeHtml(t.usuario_apodo || t.usuario_nombre || '—')}</td>
              <td>${escapeHtml(t.fecha_cierre || '')}</td>
              <td class="num">${pesos(t.monto_apertura)}</td>
              <td class="num">${pesos(esperado)}</td>
              <td class="num">${pesos(t.monto_cierre_declarado)}</td>
              <td class="num"><span class="variacion ${claseDif}">${textoDif}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function modalCierre() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Cerrar turno</h2>
      <p>Cuenta el <strong>efectivo</strong> que hay en caja (las ventas con datáfono, transferencia o Nequi no entran aquí).</p>
      <div class="linea-efectivo">
        <span>Efectivo esperado</span>
        <span id="cierre-esperado">…</span>
      </div>
      <label>Monto declarado (efectivo contado)</label>
      <input type="text" inputmode="numeric" id="cierre-monto" placeholder="0">
      <div class="error-msg" id="cierre-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="cierre-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="cierre-confirmar">Confirmar cierre</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  const cierreMonto = overlay.querySelector('#cierre-monto');
  aplicarFormatoMiles(cierreMonto);

  api('/api/caja/resumen').then((datos) => {
    const el = overlay.querySelector('#cierre-esperado');
    if (datos.turno) el.textContent = `$${datos.efectivo_esperado.toLocaleString('es-CO')}`;
  }).catch(() => {});

  overlay.querySelector('#cierre-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cierre-confirmar').addEventListener('click', async () => {
    const monto = limpiarMiles(overlay.querySelector('#cierre-monto').value);
    const errEl = overlay.querySelector('#cierre-error');
    errEl.textContent = '';
    try {
      const result = await api('/api/caja/cierre', {
        method: 'POST',
        body: JSON.stringify({ monto_declarado: monto }),
      });
      overlay.remove();
      const dif = result.diferencia;
      const signo = dif === 0 ? 'cuadra' : dif > 0 ? `sobran $${dif.toLocaleString('es-CO')}` : `faltan $${Math.abs(dif).toLocaleString('es-CO')}`;
      toast(`Cierre guardado. Caja ${signo}.`, dif === 0 ? 'success' : 'info');
      cargarResumen();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function modalEditarApertura() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Editar apertura de caja</h2>
      <p>Solo el propietario puede cambiar estos montos.</p>
      <label>Caja mayor (apertura)</label>
      <input type="text" inputmode="numeric" id="ea-mayor" placeholder="0">
      <label>Caja chica (base)</label>
      <input type="text" inputmode="numeric" id="ea-chica" placeholder="0">
      <div class="error-msg" id="ea-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="ea-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="ea-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const eaMayor = overlay.querySelector('#ea-mayor');
  const eaChica = overlay.querySelector('#ea-chica');
  aplicarFormatoMiles(eaMayor);
  aplicarFormatoMiles(eaChica);

  // Precargar los montos actuales
  api('/api/caja/resumen').then((datos) => {
    if (datos.turno) {
      eaMayor.value = (datos.turno.monto_apertura || 0).toLocaleString('es-CO');
      eaChica.value = (datos.turno.monto_caja_chica || 0).toLocaleString('es-CO');
    }
  }).catch(() => {});

  overlay.querySelector('#ea-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ea-guardar').addEventListener('click', async () => {
    const monto_apertura = limpiarMiles(eaMayor.value);
    const monto_caja_chica = limpiarMiles(eaChica.value);
    const errEl = overlay.querySelector('#ea-error');
    errEl.textContent = '';
    try {
      await api('/api/caja/apertura', {
        method: 'PUT',
        body: JSON.stringify({ monto_apertura, monto_caja_chica }),
      });
      overlay.remove();
      toast('Apertura actualizada', 'success');
      cargarResumen();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function modalCajaChica(tipo) {
  const esEntrada = tipo === 'ENTRADA';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${esEntrada ? 'Entrada' : 'Salida'} caja chica</h2>
      <label>Monto</label>
      <input type="text" inputmode="numeric" id="cc-monto" placeholder="0">
      <label>Descripción</label>
      <input type="text" id="cc-descripcion" placeholder="${esEntrada ? 'Ej: Devolución de cambio' : 'Ej: Compra de hielo'}">
      <div class="error-msg" id="cc-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="cc-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="cc-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const ccMonto = overlay.querySelector('#cc-monto');
  aplicarFormatoMiles(ccMonto);

  overlay.querySelector('#cc-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cc-guardar').addEventListener('click', async () => {
    const monto = limpiarMiles(overlay.querySelector('#cc-monto').value);
    const descripcion = overlay.querySelector('#cc-descripcion').value.trim();
    const errEl = overlay.querySelector('#cc-error');
    if (!Number.isInteger(monto) || monto <= 0) { errEl.textContent = 'Monto inválido'; return; }
    if (!descripcion) { errEl.textContent = 'Descripción obligatoria'; return; }
    try {
      await api('/api/caja/chica', {
        method: 'POST',
        body: JSON.stringify({ tipo, monto, descripcion }),
      });
      overlay.remove();
      toast('Movimiento registrado', 'success');
      cargarResumen();
      cargarCajaChica();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function modalGasto() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Nuevo gasto</h2>
      <label>Descripción</label>
      <input type="text" id="gasto-descripcion" placeholder="Ej: Arriendo, servicios...">
      <label>Monto</label>
      <input type="text" inputmode="numeric" id="gasto-monto" placeholder="0">
      <label>Categoría</label>
      <input type="text" id="gasto-categoria" placeholder="Ej: Arriendo, Servicios, Nómina...">
      <div class="error-msg" id="gasto-error"></div>
      <div class="modal-acciones">
        <button class="btn btn-ghost" id="gasto-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="gasto-guardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const gastoMonto = overlay.querySelector('#gasto-monto');
  aplicarFormatoMiles(gastoMonto);

  overlay.querySelector('#gasto-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#gasto-guardar').addEventListener('click', async () => {
    const descripcion = overlay.querySelector('#gasto-descripcion').value.trim();
    const monto = limpiarMiles(overlay.querySelector('#gasto-monto').value);
    const categoria = overlay.querySelector('#gasto-categoria').value.trim();
    const errEl = overlay.querySelector('#gasto-error');
    if (!descripcion) { errEl.textContent = 'Descripción obligatoria'; return; }
    if (!Number.isInteger(monto) || monto <= 0) { errEl.textContent = 'Monto inválido'; return; }
    if (!categoria) { errEl.textContent = 'Categoría obligatoria'; return; }
    try {
      await api('/api/gastos', {
        method: 'POST',
        body: JSON.stringify({ descripcion, monto, categoria }),
      });
      overlay.remove();
      toast('Gasto registrado', 'success');
      cargarGastos();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

window.eliminarGasto = async (id) => {
  if (!confirm('¿Eliminar este gasto?')) return;
  try {
    await api(`/api/gastos/${id}`, { method: 'DELETE' });
    toast('Gasto eliminado', 'success');
    cargarGastos();
  } catch (err) {
    toast(err.message, 'error');
  }
};
