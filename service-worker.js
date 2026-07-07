const cacheName = "meresoft-projects-brand-v3";
const assets = ["./", "./index.html", "./styles.css?v=26", "./app.js?v=26", "./manifest.webmanifest", "./icon.svg", "./favicon.ico"];
self.addEventListener("install", (event) => { self.skipWaiting(); event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets))); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (event) => { if (event.request.method !== "GET") return; event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request))); });

















