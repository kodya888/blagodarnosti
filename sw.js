// Service Worker: офлайн-кэш оболочки приложения
// Стратегия «сначала кэш»: приложение открывается мгновенно даже при плохой
// связи, свежие версии файлов докачиваются в фоне.
const CACHE = "blagodarnosti-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./vendor/supabase.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith("http")) return;

  // Данные (записи) с сервера Supabase — только через сеть, без кэша:
  // устаревший список хуже ошибки загрузки.
  if (e.request.url.includes(".supabase.")) return;

  e.respondWith(
    (async () => {
      const cached = await caches.match(e.request, { ignoreSearch: true });

      const fetchAndCache = fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => null);

      // Есть в кэше — отдаём сразу, свежую версию докачиваем в фоне
      if (cached) {
        e.waitUntil(fetchAndCache);
        return cached;
      }
      // Нет в кэше — ждём сеть; совсем без сети — пустой ответ
      return (await fetchAndCache) || new Response("", { status: 503 });
    })()
  );
});