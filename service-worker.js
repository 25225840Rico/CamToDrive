const CACHE_NAME = "camtodrive-shell-v16";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./config.js",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    // Solo se cachean respuestas validas: un 404 o un 500 cacheado dejaria la app rota.
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    // Ojo con el ultimo recurso: devolver index.html a cualquier ruta hace que sin conexion
    // /transferir.html se convierta en silencio en la app de camara. Solo vale para la raiz.
    const path = new URL(request.url).pathname;
    const esRaiz = path.endsWith("/") || path.endsWith("/index.html");
    if (request.mode === "navigate" && esRaiz) {
      const shell = await cache.match("./index.html");
      if (shell) {
        return shell;
      }
    }

    return new Response("Sin conexion: esta pagina no esta guardada para uso offline.", {
      status: 503,
      statusText: "Sin conexion",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
