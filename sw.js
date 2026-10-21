/* Verde Horizonte Admin — service worker (PWA offline) */
const CACHE = 'vh-admin-v3';

// Alle statische bestanden die offline beschikbaar moeten zijn.
const ASSETS = [
  './',
  './index.html',
  './login.html',
  './reset-password.html',
  './update-password.html',
  './klantenbeheer.html',
  './offerte.html',
  './factuur.html',
  './projecten.html',
  './nieuwe-lead.html',
  './timer.html',
  './mijn-kaartje.html',
  './style.css',
  './app.js',
  './supabase.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Supabase API-aanroepen gaan altijd naar het netwerk (niet cachen);
  // als ze falen door offline, bieden we geen gecachte respons aan.
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  if (e.request.method !== 'GET') return;

  // Navigatie-aanvragen (naar HTML-pagina's): cache-first met netwerk-fallback.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Statische assets: cache-first, daarna netwerk (en runtime-cachen).
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
