import { api } from '../api.js';
import { toast, escapeHtml, etiquetaMesa } from '../ui.js';

const pesos = (n) => `$${(n || 0).toLocaleString('es-CO')}`;
const METODOS = [
  { v: 'EFECTIVO', t: 'Efectivo' },
  { v: 'DATAFONO', t: 'Datáfono' },
  { v: 'TRANSFERENCIA', t: 'Transferencia' },
  { v: 'NEQUI', t: 'Nequi' },
];

export async function renderFacturacion(container) {
  container.classList.add('content-full');
  if (window.matchMedia('(max-width: 900px)').matches) {
    container.innerHTML = `
      <div class="modulo-header"><h2>Facturación</h2></div>
      <div class="aviso-solo-escritorio">
        <p>🧾 La facturación solo está disponible en un computador.</p>
        <p class="placeholder">En el celular puedes usar el sistema para administrar y consultar
        (por ejemplo, revisar el inventario en <b>Gestión</b>).</p>
        <p class="placeholder">Abre Chamalú Beer en el equipo de la barra para facturar.</p>
      </div>
    `;
    return;
  }

  const S = {
    productos: [],
    categorias: [],
    mesas: [],
    cuentas: [],          // cuentas abiertas (mesas + ventas sin mesa)
    items: [],
    cuenta: null,         // cuenta activa (o null si [Visitante] está vacía)
    tabActiva: 'default', // 'default' | id de la cuenta
    defaultCuentaId: null,// cuenta que respalda la pestaña [Visitante]
    filtroCat: '',
    buscar: '',
  };

  container.innerHTML = `
    <div class="fact-wrap">
      <div class="facturacion">
        <section class="fact-col fact-catalogo">
          <div class="fact-catalogo-top">
            <input type="search" id="fact-buscar" class="input-buscar" placeholder="Buscar producto...">
          </div>
          <div id="fact-chips" class="chips"></div>
          <div id="fact-productos" class="fact-productos"></div>
        </section>

        <section class="fact-col fact-venta">
          <div class="fact-venta-header">
            <div class="fact-venta-titulo">
              <h3>Venta actual</h3>
              <span id="fact-origen" class="fact-origen">Visitante</span>
            </div>
            <button class="btn btn-ghost btn-sm" id="fact-editar" title="Asignar mesa o cliente" hidden>Editar</button>
          </div>
          <div id="fact-items" class="fact-items"></div>
          <div class="fact-total"><span>Total</span><span id="fact-total">$0</span></div>
          <div class="fact-acciones">
            <button class="btn btn-primary" id="fact-cobrar">Cobrar</button>
            <button class="btn btn-ghost text-danger" id="fact-cancelar">Cancelar venta</button>
          </div>
        </section>
      </div>

      <div id="fact-tabs" class="fact-tabs"></div>
    </div>
  `;

  const $ = (id) => document.getElementById(id);

  // ---------- Carga de datos ----------
  async function cargarTodo() {
    await Promise.all([cargarProductos(), cargarCategorias(), cargarMesas(), cargarCuentas()]);
    renderChips();
    renderCatalogo();
    renderTabs();
    renderVenta();
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

  async function cargarCategorias() {
    try {
      S.categorias = await api('/api/categorias');
    } catch {
      S.categorias = [];
    }
  }

  async function cargarMesas() {
    try {
      S.mesas = await api('/api/mesas');
    } catch {
      S.mesas = [];
    }
  }

  async function cargarCuentas() {
    try {
      S.cuentas = await api('/api/cuentas?estado=ABIERTA');
    } catch {
      S.cuentas = [];
    }
  }

  // ---------- Render catálogo ----------
  function renderChips() {
    const cont = $('fact-chips');
    if (!cont) return;
    // Siempre por id de categoría: el servidor filtra por categoria_id
    const chip = (id, nombre, activo) =>
      `<button class="chip ${activo ? 'chip-activo' : ''}" data-cat="${escapeHtml(String(id))}">${escapeHtml(nombre)}</button>`;
    cont.innerHTML =
      chip('', 'Todas', S.filtroCat === '') +
      S.categorias.map((c) => chip(c.id, c.nombre, String(S.filtroCat) === String(c.id))).join('');
  }

  function renderCatalogo() {
    const cont = $('fact-productos');
    if (!cont) return;
    if (S.productos.length === 0) {
      cont.innerHTML = '<p class="placeholder">No hay productos.</p>';
      return;
    }
    cont.innerHTML = S.productos.map((p) => {
      const sinStock = p.stock_actual <= 0;
      const bajo = p.stock_actual <= p.stock_minimo;
      return `
        <button class="fact-prod ${sinStock ? 'sin-stock' : ''}" data-prod="${p.id}" ${sinStock ? 'disabled' : ''}>
          <img src="${p.imagen_url || '/img/producto-default.svg'}" alt="">
          <span class="fp-nombre">${escapeHtml(p.nombre)}</span>
          <span class="fp-precio">${pesos(p.precio_venta)}</span>
          <span class="fp-stock ${bajo ? 'stock-bajo' : ''}">Stock: ${p.stock_actual}</span>
        </button>
      `;
    }).join('');
  }

  // ---------- Barra de pestañas (abajo) ----------
  function etiquetaCuenta(c) {
    if (c.mesa_numero) return etiquetaMesa(c.mesa_numero, c.mesa_cliente || c.cliente, c.mesa_zona);
    return c.cliente || 'Visitante';
  }

  function renderTabs() {
    const cont = $('fact-tabs');
    if (!cont) return;
    const otras = S.cuentas.filter((c) => c.id !== S.defaultCuentaId);
    const tab = (activo, label, datos) =>
      `<button class="fact-tab ${activo ? 'activa' : ''}" ${datos}>${escapeHtml(label)}</button>`;
    cont.innerHTML =
      tab(S.tabActiva === 'default', 'Visitante', 'data-tab="default"') +
      otras.map((c) => tab(String(S.tabActiva) === String(c.id), etiquetaCuenta(c), `data-tab="${c.id}"`)).join('') +
      `<button class="fact-tab-add" data-accion="nueva-mesa" title="Abrir mesa">+</button>`;
  }

  // ---------- Render venta ----------
  function renderVenta() {
    const cont = $('fact-items');
    if (!cont) return;

    // Origen: deja claro si es venta rápida ([Visitante]) o si ya tiene mesa
    const origen = $('fact-origen');
    if (origen) {
      origen.classList.remove('origen-rapida', 'origen-mesa');
      if (S.tabActiva === 'default') {
        origen.textContent = 'Visitante (venta rápida)';
        origen.classList.add('origen-rapida');
      } else if (S.cuenta?.mesa_numero) {
        origen.textContent = etiquetaMesa(S.cuenta.mesa_numero, S.cuenta.mesa_cliente || S.cuenta.cliente, S.cuenta.mesa_zona);
        origen.classList.add('origen-mesa');
      } else {
        origen.textContent = S.cuenta?.cliente || 'Venta sin mesa';
      }
    }

    const btnEditar = $('fact-editar');
    if (btnEditar) btnEditar.hidden = !(S.cuenta && S.tabActiva !== 'default');

    if (S.items.length === 0) {
      cont.innerHTML = '<p class="placeholder">Agrega productos desde el catálogo.</p>';
    } else {
      cont.innerHTML = S.items.map((it) => `
        <div class="fact-item" data-item="${it.item_id ?? ''}" data-prod="${it.producto_id}">
          <span class="fi-nombre">${escapeHtml(it.nombre)}</span>
          <div class="fi-cant">
            <button data-accion="menos" aria-label="Menos">−</button>
            <input type="number" class="fi-qty" min="1" value="${it.cantidad}">
            <button data-accion="mas" aria-label="Más">+</button>
          </div>
          <span class="fi-sub">${pesos(it.subtotal)}</span>
          <button class="fi-quitar" data-accion="quitar" aria-label="Quitar">×</button>
        </div>
      `).join('');
    }
    const total = S.items.reduce((s, i) => s + i.subtotal, 0);
    const tot = $('fact-total');
    if (tot) tot.textContent = pesos(total);
  }

  // ---------- Operaciones ----------
  function totalVenta() {
    return S.items.reduce((s, i) => s + i.subtotal, 0);
  }

  // La pestaña [Visitante] se respalda con una cuenta de mostrador que se crea al primer producto
  async function asegurarDefault() {
    if (S.defaultCuentaId) return S.defaultCuentaId;
    const r = await api('/api/cuentas', { method: 'POST', body: JSON.stringify({}) });
    S.defaultCuentaId = r.cuenta_id;
    return S.defaultCuentaId;
  }

  async function idCuentaActiva() {
    if (S.tabActiva === 'default') return asegurarDefault();
    return S.cuenta?.id ?? null;
  }

  async function seleccionarCuenta(cuentaId) {
    const datos = await api(`/api/cuentas/${cuentaId}`);
    S.cuenta = {
      id: datos.cuenta.id,
      tipo: datos.cuenta.tipo,
      mesa_id: datos.cuenta.mesa_id,
      mesa_numero: datos.mesa?.numero ?? null,
      mesa_zona: datos.mesa?.zona ?? null,
      mesa_cliente: datos.mesa?.nombre_cliente ?? null,
      cliente: datos.cuenta.cliente,
    };
    S.items = datos.items.map((i) => ({
      item_id: i.id,
      producto_id: i.producto_id,
      nombre: i.producto_nombre,
      precio_unitario: i.precio_unitario,
      cantidad: i.cantidad,
      subtotal: i.subtotal,
    }));
    S.tabActiva = (S.defaultCuentaId && cuentaId === S.defaultCuentaId) ? 'default' : cuentaId;
    renderVenta();
    renderTabs();
  }

  async function recargarActiva() {
    const id = S.tabActiva === 'default' ? S.defaultCuentaId : S.cuenta?.id;
    if (!id) {
      S.items = [];
      renderVenta();
      return;
    }
    await seleccionarCuenta(id);
  }

  async function activarTab(valor) {
    if (valor === 'default') {
      if (S.defaultCuentaId) await seleccionarCuenta(S.defaultCuentaId);
      else {
        S.cuenta = null;
        S.items = [];
        S.tabActiva = 'default';
        renderVenta();
        renderTabs();
      }
    } else {
      await seleccionarCuenta(Number(valor));
    }
  }

  async function agregarProducto(productoId) {
    const prod = S.productos.find((p) => p.id === productoId);
    if (!prod) return;
    if (prod.stock_actual <= 0) {
      toast('No hay stock de ' + prod.nombre, 'error');
      return;
    }
    try {
      const cuentaId = await idCuentaActiva();
      if (!cuentaId) return;
      // ¿Ya está en la venta activa?
      const existente = (S.cuenta?.id === cuentaId || S.tabActiva === 'default' && S.defaultCuentaId === cuentaId)
        ? S.items.find((i) => i.producto_id === productoId)
        : null;
      if (existente) {
        await api(`/api/cuentas/${cuentaId}/items/${existente.item_id}`, {
          method: 'PUT',
          body: JSON.stringify({ cantidad: existente.cantidad + 1 }),
        });
      } else {
        await api(`/api/cuentas/${cuentaId}/items`, {
          method: 'POST',
          body: JSON.stringify({ producto_id: productoId, cantidad: 1 }),
        });
      }
      ajustarStockLocal(productoId, -1);
      await recargarActiva();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function cambiarCantidad(productoId, nuevaCantidad) {
    const cuentaId = S.tabActiva === 'default' ? S.defaultCuentaId : S.cuenta?.id;
    if (!cuentaId) return;
    const it = S.items.find((i) => i.producto_id === productoId);
    if (!it) return;
    const anterior = it.cantidad;
    const cant = Math.max(0, nuevaCantidad);
    try {
      await api(`/api/cuentas/${cuentaId}/items/${it.item_id}`, {
        method: 'PUT',
        body: JSON.stringify({ cantidad: cant }),
      });
      ajustarStockLocal(productoId, anterior - cant);
      await recargarActiva();
    } catch (err) {
      toast(err.message, 'error');
      renderVenta();
    }
  }

  function ajustarStockLocal(productoId, delta) {
    const p = S.productos.find((x) => x.id === productoId);
    if (p) p.stock_actual += delta;
    renderCatalogo();
  }

  // "+": abrir una mesa (nueva cuenta o la existente)
  function modalMesas() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-grande">
        <h2>Abrir mesa</h2>
        ${S.mesas.length === 0
          ? '<p class="placeholder">No hay mesas registradas. Créalas en el módulo Mesas.</p>'
          : `<div class="mesa-picker">${S.mesas.map((m) => `
              <button class="fact-mesa ${m.estado === 'LIBRE' ? 'libre' : 'ocupada'}" data-mesa="${m.id}">
                <b>${escapeHtml(etiquetaMesa(m.numero, m.nombre_cliente, m.zona))}</b>
                <span>${m.estado === 'LIBRE' ? 'Libre' : 'Ocupada'}</span>
              </button>`).join('')}</div>`}
        <div class="modal-acciones"><button class="btn btn-ghost" id="mesas-cerrar">Cerrar</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#mesas-cerrar').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mesa]');
      if (!b) return;
      overlay.remove();
      await manejarMesa(Number(b.dataset.mesa));
    });
  }

  async function manejarMesa(mesaId) {
    const mesa = S.mesas.find((m) => m.id === mesaId);
    if (!mesa) return;

    // Si "Visitante" tiene productos, al elegir una mesa se pasan a esa mesa y "Visitante" queda vacía.
    const visitanteConProductos = S.tabActiva === 'default' && S.defaultCuentaId && S.items.length > 0;
    if (visitanteConProductos) {
      if (mesa.estado !== 'LIBRE') {
        toast('La mesa está ocupada. Elige una mesa libre.', 'error');
        return;
      }
      try {
        // La misma cuenta pasa a ser la de la mesa: los productos no se tocan, solo cambia de destino.
        await api(`/api/cuentas/${S.defaultCuentaId}`, {
          method: 'PUT',
          body: JSON.stringify({ mesa_id: mesaId }),
        });
        const cuentaId = S.defaultCuentaId;
        S.defaultCuentaId = null; // "Visitante" vuelve a quedar vacía
        await cargarMesas();
        await cargarCuentas();
        await seleccionarCuenta(cuentaId);
        toast(`Productos pasados a ${etiquetaMesa(mesa.numero, mesa.nombre_cliente, mesa.zona)}`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    if (mesa.estado === 'LIBRE') {
      try {
        const r = await api('/api/cuentas', { method: 'POST', body: JSON.stringify({ mesa_id: mesaId }) });
        await cargarMesas();
        await cargarCuentas();
        await seleccionarCuenta(r.cuenta_id);
      } catch (err) {
        toast(err.message, 'error');
      }
    } else {
      const cuenta = S.cuentas.find((c) => c.mesa_id === mesaId);
      if (cuenta) await seleccionarCuenta(cuenta.id);
      else toast('No se encontró la cuenta abierta de esa mesa', 'error');
    }
  }

  // Editar mesa/cliente de la pestaña activa
  function modalEditarCuenta() {
    if (!S.cuenta) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Editar cuenta</h2>
        <div class="form-grid">
          <div>
            <label>Mesa</label>
            <select id="ec-mesa">
              <option value="">Sin mesa (venta rápida)</option>
              ${S.mesas.map((m) => {
                const ocupadaPorOtra = m.estado === 'OCUPADA' && m.id !== S.cuenta.mesa_id;
                return `<option value="${m.id}" ${m.id === S.cuenta.mesa_id ? 'selected' : ''} ${ocupadaPorOtra ? 'disabled' : ''}>${escapeHtml(etiquetaMesa(m.numero, m.nombre_cliente, m.zona))}${ocupadaPorOtra ? ' (ocupada)' : ''}</option>`;
              }).join('')}
            </select>
          </div>
          <div>
            <label>Cliente (opcional)</label>
            <input type="text" id="ec-cliente" value="${escapeHtml(S.cuenta.cliente || S.cuenta.mesa_cliente || '')}">
          </div>
        </div>
        <div class="modal-acciones">
          <button class="btn btn-ghost" id="ec-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="ec-guardar">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ec-cancelar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#ec-guardar').addEventListener('click', async () => {
      const mesaVal = overlay.querySelector('#ec-mesa').value;
      const cliente = overlay.querySelector('#ec-cliente').value.trim();
      const idCuenta = S.cuenta.id;
      try {
        await api(`/api/cuentas/${idCuenta}`, {
          method: 'PUT',
          body: JSON.stringify({ mesa_id: mesaVal ? Number(mesaVal) : null, cliente }),
        });
        overlay.remove();
        await cargarMesas();
        await cargarCuentas();
        await seleccionarCuenta(idCuenta);
        toast('Cuenta actualizada', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function limpiarVenta() {
    S.cuenta = null;
    S.items = [];
    S.tabActiva = 'default';
  }

  async function cancelarVenta() {
    const idCuenta = S.tabActiva === 'default' ? S.defaultCuentaId : S.cuenta?.id;
    if (!idCuenta) { limpiarVenta(); renderVenta(); renderTabs(); return; }
    if (!confirm('¿Cancelar esta venta? Se devolverán los productos al inventario.')) return;
    try {
      await api(`/api/cuentas/${idCuenta}`, { method: 'DELETE' });
      if (idCuenta === S.defaultCuentaId) S.defaultCuentaId = null;
      limpiarVenta();
      await cargarProductos();
      renderCatalogo();
      await cargarMesas();
      await cargarCuentas();
      renderVenta();
      renderTabs();
      toast('Venta cancelada', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- Cobro ----------
  function abrirCobro() {
    const idCuenta = S.tabActiva === 'default' ? S.defaultCuentaId : S.cuenta?.id;
    if (!idCuenta) { toast('Inicia una venta primero', 'error'); return; }
    if (S.items.length === 0) { toast('La cuenta está vacía', 'error'); return; }
    const subtotal = totalVenta();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Cobrar venta</h2>
        <div class="form-grid">
          <div>
            <label>Método de pago</label>
            <select id="cobro-metodo">
              ${METODOS.map((m) => `<option value="${m.v}">${m.t}</option>`).join('')}
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
      const esEfectivo = metodo === 'EFECTIVO';
      overlay.querySelector('#cobro-pago-con-wrap').classList.toggle('hidden', !esEfectivo);
      overlay.querySelector('#cobro-cambio-linea').classList.toggle('hidden', !esEfectivo);
      overlay.querySelector('#cobro-cambio').textContent = pesos(Math.max(0, pagoCon - aPagar));
    }
    metodoEl.addEventListener('change', recalcular);
    pagoConEl.addEventListener('input', recalcular);
    descEl.addEventListener('input', recalcular);
    propEl.addEventListener('input', recalcular);
    recalcular();

    overlay.querySelector('#cobro-cancelar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cobro-confirmar').addEventListener('click', () => {
      const errEl = overlay.querySelector('#cobro-error');
      errEl.textContent = '';
      confirmarCobro(
        idCuenta,
        {
          metodo_pago: metodoEl.value,
          pago_con: parseInt(pagoConEl.value, 10) || 0,
          descuento: Math.max(0, parseInt(descEl.value, 10) || 0),
          propina: Math.max(0, parseInt(propEl.value, 10) || 0),
        },
        () => overlay.remove(),
        errEl
      );
    });
  }

  async function confirmarCobro(idCuenta, datos, cerrarModal, errEl) {
    try {
      const result = await api(`/api/cuentas/${idCuenta}/cobrar`, {
        method: 'POST',
        body: JSON.stringify(datos),
      });
      cerrarModal?.();
      toast(`Cobro exitoso. ${result.cambio ? 'Cambio: ' + pesos(result.cambio) : ''}`, 'success');
      if (idCuenta === S.defaultCuentaId) S.defaultCuentaId = null;
      limpiarVenta();
      await cargarProductos();
      renderCatalogo();
      await cargarMesas();
      await cargarCuentas();
      renderVenta();
      renderTabs();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      toast(err.message, 'error');
    }
  }

  // ---------- Eventos (delegación) ----------
  let debounce = null;
  $('fact-buscar')?.addEventListener('input', (e) => {
    clearTimeout(debounce);
    const valor = e.target.value;
    debounce = setTimeout(async () => {
      S.buscar = valor.trim();
      await cargarProductos();
      renderCatalogo();
    }, 300);
  });

  $('fact-chips')?.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    S.filtroCat = chip.dataset.cat;
    renderChips();
    await cargarProductos();
    renderCatalogo();
  });

  $('fact-productos')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-prod]');
    if (btn) agregarProducto(Number(btn.dataset.prod));
  });

  $('fact-items')?.addEventListener('click', (e) => {
    const fila = e.target.closest('[data-prod]');
    if (!fila) return;
    const prodId = Number(fila.dataset.prod);
    const accion = e.target.dataset.accion;
    const it = S.items.find((i) => i.producto_id === prodId);
    if (!it) return;
    if (accion === 'mas') cambiarCantidad(prodId, it.cantidad + 1);
    else if (accion === 'menos') cambiarCantidad(prodId, it.cantidad - 1);
    else if (accion === 'quitar') cambiarCantidad(prodId, 0);
  });

  $('fact-items')?.addEventListener('change', (e) => {
    if (!e.target.classList.contains('fi-qty')) return;
    const fila = e.target.closest('[data-prod]');
    const prodId = Number(fila.dataset.prod);
    const qty = parseInt(e.target.value, 10);
    cambiarCantidad(prodId, Number.isInteger(qty) ? qty : 1);
  });

  $('fact-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { activarTab(tab.dataset.tab); return; }
    const add = e.target.closest('[data-accion]');
    if (add && add.dataset.accion === 'nueva-mesa') modalMesas();
  });

  $('fact-editar')?.addEventListener('click', modalEditarCuenta);
  $('fact-cobrar')?.addEventListener('click', abrirCobro);
  $('fact-cancelar')?.addEventListener('click', cancelarVenta);

  await cargarTodo();
}
