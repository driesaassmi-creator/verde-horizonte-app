/* Verde Horizonte Admin — service worker (PWA offline) */
const CACHE = 'vh-admin-v5';

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
  './offline.html',
  './style.css',
  './app.js',
  './supabase.js',
  './manifest.json',
  './icon.svg'
];

// Laatste fallback voor navigatie als de pagina zelf niet gecached is.
const OFFLINE_FALLBACK = './offline.html';

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

  // Supabase API-aanroepen gaan altijd naar het netwerk (niet cachen).
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  if (e.request.method !== 'GET') return;

  // ---- Navigatie-aanvragen (nieuwe HTML-pagina) ----
  // Strategie: 1) netwerk-first, 2) gecachte versie van die pagina,
  // 3) algemene offline-pagina (fallback) als de pagina niet gecached is.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // Alleen succesvolle HTML-responses cachen.
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => {
          // Netwerk faalde (offline). Zoek de gecachte versie van de
          // gevraagde URL. Zo niet, geef de specifieke pagina via pathname,
          // en als laatste redmiddel de algemene offline-pagina.
          return caches
            .match(e.request)
            .then((cached) => cached || caches.match(url.pathname))
            .then((cached) => cached || caches.match(OFFLINE_FALLBACK));
        })
    );
    return;
  }

  // ---- Statische assets: cache-first, daarna netwerk (en runtime-cachen). ----
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
        .catch(() => caches.match(OFFLINE_FALLBACK));
    })
  );
});
