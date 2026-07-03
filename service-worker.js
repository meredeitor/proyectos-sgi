const cacheName = "seguimiento-proyectos-auth-roles-v2";
const assets = ["./", "./index.html", "./styles.css?v=22", "./app.js?v=22", "./manifest.webmanifest", "./icon.svg", "./favicon.ico"];
self.addEventListener("install", (event) => { self.skipWaiting(); event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets))); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (event) => { if (event.request.method !== "GET") return; event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request))); });













