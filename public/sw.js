// Service worker mínimo do Nante: o jogo precisa de internet, por isso só guarda a página
// inicial para abrir mais depressa e mostrar algo se a ligação falhar à primeira.
const CACHE = 'nante-v1';
const BASICO = ['/', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASICO)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // tempo real, contas e admin vão sempre direto ao servidor
  if (/^\/(socket\.io|conta|admin)/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => {
          if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put('/', copia)); }
          return r;
        })
        .catch(() => caches.match('/'))
    );
  }
});