// Recortador de imagen con canvas (Fase G3). Sin librerías.
// Uso: abrirRecortador(dataUrlOUrl, (dataUrlRecortada) => { ... })
// Muestra un marco cuadrado (1:1); la imagen se ajusta con zoom (deslizador o rueda),
// se mueve arrastrando (mouse o táctil) y se rota en pasos de 90°.
// Al aplicar: recorta al marco, redimensiona a 800×800 y comprime a JPEG (< 2 MB).

const LADO_VISTA = 320;   // tamaño del marco en pantalla (px)
const LADO_SALIDA = 800;  // tamaño del resultado (px)
const ZOOM_MAX = 5;

export function abrirRecortador(dataUrl, alConfirmar) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-recortador">
      <h2>Ajustar imagen</h2>
      <div class="recortador-lienzo-wrap">
        <canvas class="recortador-canvas" width="${LADO_VISTA}" height="${LADO_VISTA}"></canvas>
      </div>
      <div class="recortador-controles">
        <button type="button" class="btn btn-ghost btn-sm" id="rc-rot-izq" title="Rotar a la izquierda">↺</button>
        <input type="range" id="rc-zoom" min="100" max="${ZOOM_MAX * 100}" value="100" step="1" title="Zoom">
        <button type="button" class="btn btn-ghost btn-sm" id="rc-rot-der" title="Rotar a la derecha">↻</button>
        <button type="button" class="btn btn-ghost btn-sm" id="rc-reset" title="Restablecer imagen">Reiniciar</button>
      </div>
      <p class="recortador-ayuda">Arrastra para mover · usa la rueda o el deslizador para el zoom</p>
      <div class="error-msg" id="rc-error"></div>
      <div class="modal-acciones">
        <button type="button" class="btn btn-ghost" id="rc-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primary" id="rc-aplicar">Aplicar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector('.recortador-canvas');
  const ctx = canvas.getContext('2d');
  const zoomEl = overlay.querySelector('#rc-zoom');
  const errEl = overlay.querySelector('#rc-error');

  const img = new Image();
  let listo = false;
  let rot = 0;     // grados: 0, 90, 180, 270
  let zoom = 1;
  let ox = 0;      // desplazamiento horizontal (px del marco)
  let oy = 0;      // desplazamiento vertical
  let base = 1;    // escala base para que la imagen cubra el marco

  img.onload = () => {
    listo = true;
    base = Math.max(LADO_VISTA / img.width, LADO_VISTA / img.height);
    dibujar();
  };
  img.onerror = () => {
    errEl.textContent = 'No se pudo cargar la imagen';
  };
  img.src = dataUrl;

  // La imagen siempre debe cubrir el marco: se limita el arrastre según el tamaño mostrado
  function limitar() {
    const escala = base * zoom;
    const w = (rot % 180 === 0 ? img.width : img.height) * escala;
    const h = (rot % 180 === 0 ? img.height : img.width) * escala;
    const maxX = Math.max(0, (w - LADO_VISTA) / 2);
    const maxY = Math.max(0, (h - LADO_VISTA) / 2);
    ox = Math.min(maxX, Math.max(-maxX, ox));
    oy = Math.min(maxY, Math.max(-maxY, oy));
  }

  function dibujar() {
    if (!listo) return;
    limitar();
    ctx.save();
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, LADO_VISTA, LADO_VISTA);
    ctx.translate(LADO_VISTA / 2 + ox, LADO_VISTA / 2 + oy);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(base * zoom, base * zoom);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }

  // Zoom: deslizador y rueda del ratón
  zoomEl.addEventListener('input', () => {
    zoom = Number(zoomEl.value) / 100;
    dibujar();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(ZOOM_MAX, Math.max(1, zoom + (e.deltaY < 0 ? 0.1 : -0.1)));
    zoomEl.value = String(Math.round(zoom * 100));
    dibujar();
  }, { passive: false });

  // Rotar en pasos de 90° (opción A aprobada); al rotar se recentra la imagen
  function rotar(grados) {
    rot = (rot + grados + 360) % 360;
    ox = 0;
    oy = 0;
    dibujar();
  }
  overlay.querySelector('#rc-rot-izq').addEventListener('click', () => rotar(-90));
  overlay.querySelector('#rc-rot-der').addEventListener('click', () => rotar(90));
  overlay.querySelector('#rc-reset').addEventListener('click', () => {
    rot = 0;
    zoom = 1;
    ox = 0;
    oy = 0;
    zoomEl.value = '100';
    dibujar();
  });

  // Arrastrar con mouse o dedo (pointer events cubren ambos)
  let arrastrando = false;
  let px = 0;
  let py = 0;
  canvas.addEventListener('pointerdown', (e) => {
    arrastrando = true;
    px = e.clientX;
    py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('arrastrando');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    ox += e.clientX - px;
    oy += e.clientY - py;
    px = e.clientX;
    py = e.clientY;
    dibujar();
  });
  const soltar = () => {
    arrastrando = false;
    canvas.classList.remove('arrastrando');
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);

  overlay.querySelector('#rc-cancelar').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#rc-aplicar').addEventListener('click', () => {
    if (!listo) {
      errEl.textContent = 'La imagen aún no está lista';
      return;
    }
    const salida = recortar(LADO_SALIDA);
    overlay.remove();
    if (typeof alConfirmar === 'function') alConfirmar(salida);
  });

  // Exporta el marco a un canvas de `lado`×`lado` como JPEG comprimido
  function recortar(lado) {
    const k = lado / LADO_VISTA;
    const out = document.createElement('canvas');
    out.width = lado;
    out.height = lado;
    const octx = out.getContext('2d');
    // Fondo blanco: JPEG no admite transparencia
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, lado, lado);
    octx.translate(lado / 2 + ox * k, lado / 2 + oy * k);
    octx.rotate(rot * Math.PI / 180);
    octx.scale(base * zoom * k, base * zoom * k);
    octx.drawImage(img, -img.width / 2, -img.height / 2);
    // Si el JPEG supera 2 MB, se baja la calidad hasta que quepa
    for (const calidad of [0.85, 0.7, 0.55]) {
      const url = out.toDataURL('image/jpeg', calidad);
      if (bytesBase64(url) <= 2 * 1024 * 1024) return url;
    }
    return out.toDataURL('image/jpeg', 0.55);
  }

  function bytesBase64(dataUrl) {
    const i = dataUrl.indexOf(',');
    return Math.round((dataUrl.length - i - 1) * 3 / 4);
  }
}
