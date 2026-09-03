'use strict';

const CACHE_NAME = 'scontrini-jb-cache-v46';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo-transparent.png',
  './icons/qr-fatturazione.png',
  './templates/rimborso_spese_base.pdf',
  './templates/report_attivita_base.pdf',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // { cache: 'reload' } forza il download da rete di ogni file, ignorando la
      // cache HTTP del browser: senza questo, una versione nuova del service worker
      // potrebbe comunque salvarsi dentro copie vecchie di app.js/index.html se il
      // browser le aveva ancora "fresche" nella propria cache HTTP interna.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

// Le chiamate al backend condiviso (login, sincronizzazione spese/ricevute/
// attività/ecc.) non vanno MAI servite dalla cache: sono dati dinamici, non
// asset statici. Senza questa esclusione, la prima GET verso un URL come
// "/ricevute?meseAnno=2026-09" (magari con risposta ancora vuota) restava
// fissata in cache per sempre, e l'app non vedeva più i dati nuovi scaricati
// dal server per quello stesso URL — scoperto testando la Fase 2b: sembrava
// un bug di sincronizzazione, era la cache del service worker.
const ORIGINE_BACKEND = 'https://lb-gestionale-ai.arianuova.workers.dev';

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith(ORIGINE_BACKEND)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
