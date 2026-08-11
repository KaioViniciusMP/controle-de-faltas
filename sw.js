const CACHE_NAME = 'faltas-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './supabaseClient.js',
  './data-layer.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Rede primeiro: sempre busca a versão mais nova quando há conexão com o servidor,
// e só recorre ao cache salvo se a rede falhar (uso offline de verdade).
// Só mexe nos arquivos do próprio app (mesma origem) - chamadas ao Supabase e ao
// CDN do supabase-js passam direto pela rede, sem cache do service worker.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return resposta;
      })
      .catch(() => caches.match(event.request))
  );
});

// Melhor esforço: em navegadores/instalações que suportam Periodic Background Sync
// (hoje, praticamente só Chrome/Android com o PWA instalado), isso dispara uma
// notificação local mesmo com o app fechado. Sem suporte, este evento nunca dispara
// e o lembrete só aparece quando o app é aberto.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-faltas') {
    event.waitUntil(
      self.registration.showNotification('Faltas - lembrete', {
        body: 'Abra o app para confirmar sua presença nos dias pendentes.',
        icon: 'icons/icon-192.png',
        tag: 'faltas-pendentes',
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
