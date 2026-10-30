// Aviso de actualización de la PWA.
// Muestra un botón cuando el navegador ya descargó una versión nueva (service
// worker en espera) o cuando el servidor reporta una versión distinta.
import { api } from './api.js';
import { state } from './state.js';

const CLAVE_ACTUALIZADA = 'chamalu_actualizada_en';
const ESPERA_MS = 60 * 1000;

let registroSW = null;
let recargando = false;
let controlado = false;

function actualizadaHacePoco() {
  const momento = Number(sessionStorage.getItem(CLAVE_ACTUALIZADA) || 0);
  return momento > 0 && Date.now() - momento < ESPERA_MS;
}

function recargar() {
  sessionStorage.setItem(CLAVE_ACTUALIZADA, String(Date.now()));
  window.location.reload();
}

export function iniciarPWA() {
  const banner = document.getElementById('banner-actualizacion');
  const boton = document.getElementById('btn-actualizar-app');
  if (!banner || !boton) return;

  const mostrar = () => {
    // Si acabamos de actualizar, la página ya está al día: no molestar
    if (actualizadaHacePoco()) {
      if (registroSW && registroSW.waiting) {
        registroSW.waiting.postMessage({ tipo: 'SKIP_WAITING' });
      }
      return;
    }
    banner.classList.remove('hidden');
  };

  boton.addEventListener('click', () => {
    boton.disabled = true;
    boton.textContent = 'Actualizando…';
    if (registroSW && registroSW.waiting) {
      registroSW.waiting.postMessage({ tipo: 'SKIP_WAITING' });
      // Respaldo por si el navegador no dispara controllerchange
      setTimeout(() => {
        if (!recargando) {
          recargando = true;
          recargar();
        }
      }, 2000);
    } else {
      recargar();
    }
  });

  if (!('serviceWorker' in navigator)) return;
  controlado = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // No recargar en la primera instalación ni si ya estamos al día
    if (!controlado || recargando || actualizadaHacePoco()) return;
    recargando = true;
    recargar();
  });

  window.addEventListener('load', async () => {
    try {
      registroSW = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      if (registroSW.waiting && controlado) mostrar();
      registroSW.addEventListener('updatefound', () => {
        const nuevo = registroSW.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && controlado) mostrar();
        });
      });
      await registroSW.update();
    } catch {
      // sin service worker seguimos funcionando normal
    }
  });

  const revisarVersion = async () => {
    try {
      const datos = await api('/api/version');
      if (datos.version && state.version && datos.version !== state.version) mostrar();
    } catch {
      // sin conexión o servidor caído: se reintenta luego
    }
  };
  window.addEventListener('load', revisarVersion);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarVersion();
  });
  setInterval(revisarVersion, 5 * 60 * 1000);
}
