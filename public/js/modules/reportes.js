import { api } from '../api.js';
import { toast, escapeHtml, hoyCO, vigilarCambioDeDia } from '../ui.js';

const NOMBRE_METODO = {
  EFECTIVO: 'Efectivo',
  DATAFONO: 'Datáfono',
  TRANSFERENCIA: 'Transferencia',
  NEQUI: 'Nequi',
};

function pesos(n) {
  return `$${(n || 0).toLocaleString('es-CO')}`;
}

// Criterio para "Productos más vendidos": unidades (por defecto) o ingresos
let criterio = 'cantidad';
let ultimosDatos = null;

export async function renderReportes(container) {
  let hoy = hoyCO();
  criterio = 'cantidad';
  ultimosDatos = null;

  container.innerHTML = `
    <div class="modulo-header">
      <h2>Reportes</h2>
    </div>
    <div class="filtros filtros-reportes">
      <label>Desde <input type="date" id="rep-desde" value="${hoy}"></label>
      <label>Hasta <input type="date" id="rep-hasta" value="${hoy}"></label>
      <label>Productos por
        <select id="rep-criterio">
          <option value="cantidad" selected>Unidades</option>
          <option value="total">Ingresos</option>
        </select>
      </label>
      <button id="rep-ver" class="btn btn-primary">Ver reporte</button>
    </div>
    <div id="rep-resultado"></div>
  `;

  container.querySelector('#rep-ver').addEventListener('click', cargarReporte);
  container.querySelector('#rep-criterio').addEventListener('change', (e) => {
    criterio = e.target.value;
    const cont = document.getElementById('rep-resultado');
    if (cont && ultimosDatos) cont.innerHTML = plantilla(ultimosDatos);
  });
  await cargarReporte();

  // Al cambiar el día, si las fechas seguían en "hoy", las movemos al nuevo día
  vigilarCambioDeDia((nuevo) => {
    const desde = container.querySelector('#rep-desde');
    const hasta = container.querySelector('#rep-hasta');
    let refrescar = false;
    if (desde && desde.value === hoy) { desde.value = nuevo; refrescar = true; }
    if (hasta && hasta.value === hoy) { hasta.value = nuevo; refrescar = true; }
    hoy = nuevo;
    if (refrescar) cargarReporte();
  });
}

async function cargarReporte() {
  const cont = document.getElementById('rep-resultado');
  if (!cont) return;
  const desde = document.getElementById('rep-desde').value;
  const hasta = document.getElementById('rep-hasta').value;
  if (desde && hasta && desde > hasta) {
    toast('La fecha "desde" no puede ser mayor que "hasta"', 'error');
    return;
  }
  try {
    const url = `/api/reportes?desde=${desde}&hasta=${hasta}`;
    const datos = await api(url);
    ultimosDatos = datos;
    cont.innerHTML = plantilla(datos);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function plantilla(datos) {
  const { resumen, por_metodo, por_usuario, top_productos } = datos;

  const metodos = por_metodo.length === 0
    ? '<p class="placeholder">Sin ventas en el rango.</p>'
    : `<table class="tabla-reporte">
        <thead><tr><th>Método</th><th class="num">Ventas</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${por_metodo.map((m) => `
            <tr>
              <td>${escapeHtml(NOMBRE_METODO[m.metodo_pago] || m.metodo_pago)}</td>
              <td class="num">${m.cantidad}</td>
              <td class="num">${pesos(m.total)}</td>
            </tr>`).join('')}
          <tr class="fila-total">
            <td>Total general</td>
            <td class="num">${resumen.cantidad}</td>
            <td class="num">${pesos(resumen.total)}</td>
          </tr>
        </tbody>
      </table>`;

  const usuarios = por_usuario.length === 0
    ? '<p class="placeholder">Sin datos.</p>'
    : `<table class="tabla-reporte">
        <thead><tr><th>Usuario</th><th class="num">Ventas</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${por_usuario.map((u) => `
            <tr>
              <td>${escapeHtml(u.usuario)}</td>
              <td class="num">${u.cantidad}</td>
              <td class="num">${pesos(u.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

  const productos = top_productos.length === 0
    ? '<p class="placeholder">Sin productos vendidos.</p>'
    : (() => {
        const ordenados = [...top_productos].sort((a, b) => (b[criterio] || 0) - (a[criterio] || 0));
        const titulo = criterio === 'cantidad' ? 'Unidades' : 'Ingresos';
        return `<table class="tabla-reporte">
        <thead><tr><th>Producto</th><th class="num">Unidades</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${ordenados.map((p) => `
            <tr>
              <td>${escapeHtml(p.producto)}</td>
              <td class="num">${p.cantidad}</td>
              <td class="num">${pesos(p.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="nota-criterio">Ordenado por: ${titulo}</p>`;
      })();

  return `
    <div class="grid-dashboard">
      <div class="tarjeta-dashboard">
        <span class="dashboard-sub">Total vendido</span>
        <span class="resumen-valor">${pesos(resumen.total)}</span>
      </div>
      <div class="tarjeta-dashboard">
        <span class="dashboard-sub">Cantidad de ventas</span>
        <span class="resumen-valor">${resumen.cantidad}</span>
      </div>
      <div class="tarjeta-dashboard">
        <span class="dashboard-sub">Descuentos</span>
        <span class="resumen-valor">${pesos(resumen.descuentos)}</span>
      </div>
      <div class="tarjeta-dashboard">
        <span class="dashboard-sub">Propinas (aparte)</span>
        <span class="resumen-valor">${pesos(resumen.propinas)}</span>
      </div>
    </div>
    <div class="reporte-seccion">
      <h3>Por método de pago</h3>
      ${metodos}
    </div>
    <div class="reporte-seccion">
      <h3>Por usuario</h3>
      ${usuarios}
    </div>
    <div class="reporte-seccion">
      <h3>Productos más vendidos</h3>
      ${productos}
    </div>
  `;
}
