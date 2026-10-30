// Service worker de la PWA.
// Estrategia: red primero (para que las actualizaciones lleguen siempre) y
// caché como respaldo cuando no hay conexión. Las rutas /api/ nunca se cachean.
const CACHE_NAME = 'chamalu-beer-v4';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/variables.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/app.js',
  '/js/api.js',
  '/js/state.js',
  '/js/ui.js',
  '/img/logo-default.svg',
  '/img/producto-default.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
  // No se activa sola: espera a que el usuario pulse "Actualizar" en la app
});

// La app avisa cuando el usuario acepta la actualización
self.addEventListener('message', (event) => {
  if (event.data && event.data.tipo === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo GET, fuera de la API y del panel privado del desarrollador
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('/panel-dev')) return;

  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        // Guardamos una copia para poder abrir sin conexión
        if (respuesta && respuesta.status === 200 && respuesta.type === 'basic') {
          const copia = respuesta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia)).catch(() => {});
        }
        return respuesta;
      })
      .catch(async () => {
        const cacheado = await caches.match(event.request);
        if (cacheado) return cacheado;
        if (event.request.destination === 'document') {
          const inicio = await caches.match('/index.html');
          if (inicio) return inicio;
        }
        return new Response('', { status: 504, statusText: 'Sin conexión' });
      })
  );
});
