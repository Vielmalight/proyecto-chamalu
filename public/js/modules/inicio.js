import { api } from '../api.js';
import { state } from '../state.js';
import { toast, escapeHtml } from '../ui.js';

const money = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`;

// Compara el valor de hoy contra el de ayer y devuelve un indicador con color
function variacion(hoy, ayer) {
  if (!ayer) {
    if (hoy > 0) return { texto: '▲ nuevo', clase: 'var-up' };
    return { texto: '—', clase: '' };
  }
  const pct = ((hoy - ayer) / ayer) * 100;
  if (Math.abs(pct) < 0.5) return { texto: '= 0%', clase: '' };
  const clase = pct > 0 ? 'var-up' : 'var-down';
  return { texto: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`, clase };
}

function tarjetaComparacion(label, valor, valorAyer) {
  const v = variacion(valor, valorAyer);
  return `
    <div class="tarjeta-dashboard">
      <span class="resumen-label">${escapeHtml(label)}</span>
      <span class="resumen-valor">${money(valor)}</span>
      <span class="dashboard-sub">Ayer: ${money(valorAyer)} <span class="variacion ${v.clase}">${v.texto}</span></span>
    </div>`;
}

function tarjetaSimple(label, valor, sub) {
  return `
    <div class="tarjeta-dashboard">
      <span class="resumen-label">${escapeHtml(label)}</span>
      <span class="resumen-valor">${escapeHtml(String(valor))}</span>
      <span class="dashboard-sub">${escapeHtml(sub)}</span>
    </div>`;
}

export async function renderInicio(container) {
  const nombre = state.usuario.apodo || state.usuario.nombre;

  container.innerHTML = `
    <div class="modulo-header">
      <div>
        <h2>Inicio</h2>
        <p class="inicio-saludo">Bienvenido, ${escapeHtml(nombre)}</p>
      </div>
      <span id="inicio-fecha" class="inicio-fecha"></span>
    </div>
    <div id="inicio-resumen" class="grid-dashboard"></div>
    <h3>Alertas</h3>
    <div id="inicio-alertas" class="lista-alertas"></div>
  `;

  try {
    const r = (await api('/api/dashboard/resumen')) || {};
    const fechaEl = document.getElementById('inicio-fecha');
    const resumenEl = document.getElementById('inicio-resumen');
    const listaAlertas = document.getElementById('inicio-alertas');
    if (!fechaEl || !resumenEl || !listaAlertas) return;

    // Blindaje: si el servidor devuelve un formato inesperado, no rompemos la pantalla
    const hoy = r.hoy || {};
    const ayer = r.ayer || {};
    const pendientes = r.pendientes || {};
    const alertas = Array.isArray(r.alertas) ? r.alertas : [];
    fechaEl.textContent = `Hoy: ${r.fecha || hoy.fecha || ''}`.trim();

    const tarjetas = [
      tarjetaComparacion('Ventas de hoy', hoy.ventas || 0, ayer.ventas || 0),
    ];

    // El cajero no recibe ganancia ni pérdida (no debe ver costos ni gastos)
    if (hoy.ganancia !== undefined) {
      tarjetas.push(tarjetaComparacion('Ganancia de hoy', hoy.ganancia, ayer.ganancia || 0));
      tarjetas.push(tarjetaSimple(
        'Pérdidas del día',
        money(hoy.perdida),
        `Gastos ${money(hoy.gastos)} + Descuadres ${money(hoy.descuadre)}`
      ));
    }

    tarjetas.push(tarjetaSimple(
      'Cuentas pendientes',
      pendientes.cantidad || 0,
      `por cobrar: ${money(pendientes.total)}`
    ));
    tarjetas.push(tarjetaSimple('Mesas ocupadas', `${r.mesas_ocupadas || 0} / ${r.mesas_total || 0}`, 'en uso'));
    tarjetas.push(tarjetaSimple('Stock bajo', r.stock_bajo || 0, 'productos por reponer'));

    if (r.turno_caja) {
      tarjetas.push(tarjetaSimple(
        'Ventas del turno',
        money(r.turno_caja.ventas_turno),
        `Apertura: ${money(r.turno_caja.monto_apertura)}`
      ));
      tarjetas.push(tarjetaSimple('Caja chica', money(r.turno_caja.caja_chica_saldo), 'saldo disponible'));
    }

    resumenEl.innerHTML = tarjetas.join('');

    if (alertas.length === 0) {
      listaAlertas.innerHTML = '<p class="placeholder">Sin alertas pendientes.</p>';
    } else {
      listaAlertas.innerHTML = alertas.map((a) => `
        <div class="item-alerta">
          <span class="alerta-mensaje">${escapeHtml(a.mensaje)}</span>
          <span class="alerta-fecha">${escapeHtml(a.creado_en)}</span>
        </div>
      `).join('');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}
