import { state } from './state.js';

export function setTheme(tema) {
  state.tema = tema;
  document.documentElement.setAttribute('data-theme', tema);
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Etiqueta de una mesa: "Mesa 5", "Terraza 5" (con zona) o "Mesa Juan"/"Terraza Juan" si tiene nombre de cliente
export function etiquetaMesa(numero, nombre, zona = '') {
  return `${(zona || '').trim() || 'Mesa'} ${nombre ? nombre : numero}`;
}

export function toast(msg, tipo = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function mostrar(id) {
  document.getElementById(id).classList.remove('hidden');
}

export function ocultar(id) {
  document.getElementById(id).classList.add('hidden');
}

// Fecha de hoy en hora Colombia (UTC-5) en formato 'YYYY-MM-DD'
export function hoyCO() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Formatear número con puntos de miles para inputs monetarios
export function formatearMiles(valor) {
  const num = String(valor || '').replace(/\D/g, '');
  if (!num || num === '0') return '';
  return Number(num).toLocaleString('es-CO');
}

// Limpiar puntos y convertir a número
export function limpiarMiles(valor) {
  const num = String(valor || '').replace(/\D/g, '');
  return num === '' ? 0 : Number(num);
}

// Aplicar formato de miles a un input con comportamiento "0 invisible"
export function aplicarFormatoMiles(input) {
  if (!input) return;
  if (!input.placeholder) input.placeholder = '0';
  
  const formatear = () => {
    const valorAntes = input.value;
    const limpio = valorAntes.replace(/\D/g, '');
    if (limpio === '' || limpio === '0') {
      input.value = '';
      return;
    }
    const formateado = Number(limpio).toLocaleString('es-CO');
    input.value = formateado;
  };
  
  input.addEventListener('input', formatear);
  input.addEventListener('focus', () => {
    if (input.value === '') input.placeholder = '';
  });
  input.addEventListener('blur', () => {
    const limpio = (input.value || '').replace(/\D/g, '');
    if (limpio === '' || limpio === '0') {
      input.value = '';
    }
    if (input.value === '') input.placeholder = '0';
  });
}
}

// Avisa cuando cambia el día (medianoche en Colombia) para refrescar filtros de fecha.
// Devuelve el intervalo para poder detenerlo si se necesita.
export function vigilarCambioDeDia(callback) {
  let dia = hoyCO();
  return setInterval(() => {
    const nuevo = hoyCO();
    if (nuevo !== dia) {
      dia = nuevo;
      callback(nuevo);
    }
  }, 30000);
}
