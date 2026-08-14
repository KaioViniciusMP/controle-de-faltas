const CACHE_NAME = 'faltas-v5';
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

// Lembrete em segundo plano via Web Push: a Edge Function `lembrete-diario`
// (Supabase, agendada por cron) envia isto para quem ainda não confirmou
// presença hoje. Funciona com o navegador/app fechado, em qualquer
// navegador com suporte a Push API (Chrome/Firefox/Edge, e Safari em
// iOS 16.4+ quando o PWA foi instalado na tela inicial).
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || 'Faltas - lembrete';
  const options = {
    body: payload.body || 'Abra o app para confirmar sua presença de hoje.',
    icon: 'icons/icon-192.png',
    tag: payload.tag || 'faltas-pendentes',
    data: { url: payload.url || './index.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
