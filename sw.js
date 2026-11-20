/* Discogs Sniper v3.0 PWA Service Worker */
const CACHE_NAME = "discogs-sniper-v3.0.0";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./favicon.ico",
  "./favicon-32x32.png",
  "./apple-touch-icon.png",
];

const BYPASS_HOSTS = [
  "api.discogs.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "itunes.apple.com",
  "audio-ssl.itunes.apple.com",
  "api.deezer.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("discogs-sniper-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }

  // Never cache authenticated or live API traffic or sibling vault JSON
  if (BYPASS_HOSTS.includes(url.hostname)) return;
  if (url.hostname === "krunked-fpv.github.io" && url.pathname.includes("/discogs_collection/data/")) {
    return;
  }

  // Same-origin HTML navigation & ./data/*.json -> Network-First with cache fallback
  if (url.origin === self.location.origin) {
    const isHtmlOrData =
      req.mode === "navigate" ||
      url.pathname.endsWith(".html") ||
      url.pathname.endsWith("/") ||
      url.pathname.includes("/data/");

    if (isHtmlOrData) {
      event.respondWith(
        fetch(req)
          .then((resp) => {
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return resp;
          })
          .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
      );
      return;
    }

    // Same-origin static assets (icons, manifest) -> Stale-While-Revalidate
    event.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req)
          .then((resp) => {
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return resp;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Google Fonts & static styling -> Stale-While-Revalidate
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req)
          .then((resp) => {
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return resp;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
  }
});
