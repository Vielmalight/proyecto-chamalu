// Lanzador de todas las pruebas.
// - Corre integración contra una base de datos temporal (no toca data/chamalu.db)
// - Levanta el servidor en un puerto libre y corre las pruebas end-to-end
// - Al terminar, apaga el servidor y borra la base temporal
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

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

function ejecutar(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    p.on('exit', (code) => resolve(code ?? 0));
  });
}

async function esperarServidor(base, timeoutMs = 15000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    try {
      const res = await fetch(base + '/api/auth/me');
      if (res.status === 401 || res.status === 200) return true;
    } catch {
      // El servidor aún no responde
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chamalu-test-'));
const backupsDir = path.join(tmp, 'backups');
fs.mkdirSync(backupsDir, { recursive: true });
const env = {
  DB_PATH: path.join(tmp, 'chamalu.db'),
  BACKUPS_DIR: backupsDir,
  SESSION_SECRET: 'test-secret',
  NODE_ENV: 'test',
};

function limpiar() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignorar */ }
}

let codigo = 0;

console.log('\n=== Pruebas de integración ===');
codigo = await ejecutar(['--test', 'tests/integracion.test.js'], env);

if (codigo !== 0) {
  console.error('\nLas pruebas de integración fallaron; no se corre el end-to-end.');
  limpiar();
  process.exit(codigo);
}

const port = await puertoLibre();
const base = `http://127.0.0.1:${port}`;
const servidor = spawn(process.execPath, ['server/app.js'], {
  cwd: ROOT,
  env: { ...process.env, ...env, PORT: String(port) },
  stdio: 'ignore',
});

try {
  const listo = await esperarServidor(base);
  if (!listo) {
    console.error('\nEl servidor de pruebas no arrancó a tiempo.');
    codigo = 1;
  } else {
    console.log('\n=== Pruebas end-to-end ===');
    codigo = await ejecutar(['--test', 'tests/e2e.test.js'], { TEST_BASE: base });
  }
} finally {
  servidor.kill();
  limpiar();
}

process.exit(codigo);
