// Prueba de humo del frontend (Chrome/Edge headless + CDP).
// - NO toca la BD real ni el .env: usa una BD temporal y puertos libres.
// - Siembra datos de ejemplo y recorre cada pestaña del menú.
// - Detecta: contenido vacío, toasts de error, errores de consola y
//   excepciones no capturadas, y que la grilla de mesas dibuje sus tarjetas.
//
// Uso:  npm run test:smoke
// Requiere Google Chrome o Microsoft Edge instalado (o definir CHROME_PATH).
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function buscarNavegador() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const candidatos = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (const c of candidatos) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

const navegador = buscarNavegador();
if (!navegador) {
  console.warn('\n[smoke] No se encontro Chrome ni Edge. Prueba de humo OMITIDA.');
  console.warn('[smoke] Instala Chrome o define la variable CHROME_PATH con la ruta al ejecutable.');
  process.exit(0);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chamalu-smoke-'));
const DB_PATH = path.join(TMP, 'smoke.db');
const BACKUPS_DIR = path.join(TMP, 'backups');
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const PORT = await puertoLibre();
const DEBUG_PORT = await puertoLibre();
const BASE = `http://127.0.0.1:${PORT}`;

let servidor = null;
let chrome = null;

function limpiar() {
  if (chrome) {
    try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }); }
    catch { try { chrome.kill(); } catch { /* ignorar */ } }
  }
  try { if (servidor) servidor.kill(); } catch { /* ignorar */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignorar */ }
}

try {
  // --- 1. Preparar la BD temporal reutilizando el modulo real del proyecto ---
  process.env.DB_PATH = DB_PATH;
  process.env.BACKUPS_DIR = BACKUPS_DIR;
  process.env.SESSION_SECRET = 'smoke-secret-no-real';
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'development';

  const dbUrl = pathToFileURL(path.join(ROOT, 'server', 'config', 'db.js')).href;
  const { db, initSchema, seedAdmin } = await import(dbUrl);
  await initSchema();
  await seedAdmin();

  // El admin no debe pedir cambio de clave en esta prueba
  db.prepare("UPDATE usuarios SET debe_cambiar_password = 0 WHERE usuario = 'admin'").run();

  // Datos de ejemplo (al menos una mesa OCUPADA para forzar el render de tarjetas)
  const catId = db.prepare('INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)').run('Cervezas', 'Prueba').lastInsertRowid;
  const insProd = db.prepare('INSERT INTO productos (nombre, categoria_id, precio_compra, precio_venta, stock_actual, stock_minimo) VALUES (?, ?, ?, ?, ?, ?)');
  insProd.run('Cerveza Rubia', catId, 2000, 5000, 24, 6);
  insProd.run('Cerveza Negra', catId, 2200, 5500, 10, 6);
  db.prepare('INSERT INTO mesas (numero, nombre_cliente, estado) VALUES (?, ?, ?)').run(1, null, 'LIBRE');
  db.prepare('INSERT INTO mesas (numero, nombre_cliente, estado) VALUES (?, ?, ?)').run(2, 'Familia Rodriguez', 'OCUPADA');
  db.close();

  // --- 2. Levantar el servidor con la BD temporal ---
  servidor = spawn(process.execPath, [path.join(ROOT, 'server', 'app.js')], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let listo = false;
  for (let i = 0; i < 60 && !listo; i++) {
    try { const r = await fetch(BASE + '/'); listo = r.ok; } catch { /* aun no */ }
    if (!listo) await sleep(300);
  }
  if (!listo) throw new Error('El servidor temporal no arranco.');

  // --- 3. Lanzar el navegador headless con depuracion remota ---
  const profileDir = path.join(TMP, 'chrome-profile');
  chrome = spawn(navegador, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' });

  let chromeListo = false;
  for (let i = 0; i < 60 && !chromeListo; i++) {
    try { const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`); chromeListo = r.ok; } catch { /* aun no */ }
    if (!chromeListo) await sleep(300);
  }
  if (!chromeListo) throw new Error('El navegador no expuso el puerto de depuracion.');

  // --- 4. Conectar por CDP al target de la pagina ---
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No hay target de pagina en el navegador.');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let msgId = 0;
  const pending = new Map();
  const errores = [];
  let tabActual = 'carga';

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errores.push({ tab: tabActual, tipo: 'excepcion', texto: d.exception?.description || d.text });
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errores.push({ tab: tabActual, tipo: 'console.error', texto: msg.params.args.map((a) => a.value || a.description || '').join(' ') });
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errores.push({ tab: tabActual, tipo: 'log', texto: msg.params.entry.text });
    }
  });

  async function evalExpr(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }

  async function waitFor(expr, timeout = 15000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      try { if (await evalExpr(expr)) return true; } catch { /* reintentar */ }
      await sleep(200);
    }
    return false;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  // --- 5. Login + apertura de caja (por API, desde la propia pagina) ---
  await send('Page.navigate', { url: BASE });
  await waitFor("!!document.getElementById('login-form')");

  const login = await evalExpr(`(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'admin', password: 'admin123' }) });
    const data = await r.json().catch(() => ({}));
    window.__csrf = data.csrf_token || '';
    return r.status;
  })()`);
  if (login !== 200) throw new Error(`Login fallo (HTTP ${login}).`);

  const apertura = await evalExpr(`(async () => {
    const r = await fetch('/api/caja/apertura', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__csrf },
      body: JSON.stringify({ monto_apertura: 50000, monto_caja_chica: 10000 }) });
    return r.status;
  })()`);
  if (apertura !== 200) throw new Error(`Apertura de caja fallo (HTTP ${apertura}).`);

  // --- 6. Recargar para entrar al shell autenticado ---
  await send('Page.navigate', { url: BASE });
  if (!(await waitFor("!!document.querySelector('#sidebar button')", 20000))) {
    throw new Error('El shell de la aplicacion no cargo.');
  }

  const modulos = await evalExpr("[...document.querySelectorAll('#sidebar button')].map(b => b.dataset.modulo)");

  // --- 7. Recorrer cada pestana y revisar su contenido ---
  const informe = [];
  for (const mod of modulos) {
    tabActual = mod;
    await evalExpr("document.querySelectorAll('.toast').forEach(t => t.remove())");
    await evalExpr(`document.querySelector('#sidebar button[data-modulo="${mod}"]').click()`);
    await sleep(1000);

    // En Facturación, además, se agrega el primer producto al catálogo (Fase 3 - Fase C)
    if (mod === 'facturacion') {
      await evalExpr(`(() => {
        const b = document.querySelector('#fact-productos .fact-prod:not([disabled])');
        if (b) b.click();
      })()`);
      await waitFor("document.querySelector('#fact-items .fact-item')", 5000);
    }

    const res = await evalExpr(`(() => {
      const c = document.getElementById('content');
      const html = c ? c.innerHTML : '';
      return {
        len: html.length,
        vacio: (!html.trim() || /en construcci/i.test(html)),
        toasts: [...document.querySelectorAll('.toast.error')].map(t => t.textContent),
        mesasRenderizadas: document.querySelectorAll('#grid-mesas .tarjeta-mesa').length,
        itemsFacturacion: document.querySelectorAll('#fact-items .fact-item').length,
        pistaError: /is not defined|Cannot read propert|of undefined|of null|is not a function/i.test(html),
      };
    })()`);
    informe.push({ modulo: mod, ...res });
  }

  // --- 8. Reporte ---
  const fallas = [];
  console.log('\n================ PRUEBA DE HUMO DEL FRONTEND ================');
  for (const r of informe) {
    const problemas = [];
    if (r.vacio) problemas.push('contenido vacio / en construccion');
    if (r.pistaError) problemas.push('texto de error en pantalla');
    if (r.toasts.length) problemas.push('toast: ' + r.toasts.join(' | '));
    if (r.modulo === 'mesas' && r.mesasRenderizadas === 0) problemas.push('sin mesas renderizadas');
    if (r.modulo === 'facturacion' && r.itemsFacturacion === 0) problemas.push('no se agrego producto al catalogo');
    const estado = problemas.length ? 'FALLA' : 'OK';
    if (problemas.length) fallas.push(r.modulo);
    console.log(`${estado.padEnd(6)} ${r.modulo.padEnd(14)} len=${String(r.len).padEnd(6)} mesas=${r.mesasRenderizadas} ${problemas.join(' ; ')}`);
  }

  console.log('\n---- Errores de consola / excepciones ----');
  if (errores.length === 0) console.log('Ninguno.');
  else for (const e of errores) console.log(`[${e.tab}] ${e.tipo}: ${e.texto}`);

  const totalFallas = new Set([...fallas, ...errores.map((e) => e.tab)]).size;
  console.log(`\nRESUMEN: ${informe.length - fallas.length}/${informe.length} pestanas OK, ${errores.length} errores de consola/excepcion.`);

  try { ws.close(); } catch { /* ignorar */ }
  limpiar();
  process.exit(totalFallas > 0 ? 1 : 0);
} catch (err) {
  console.error('\n[smoke] Error: ' + err.message);
  limpiar();
  process.exit(1);
}
