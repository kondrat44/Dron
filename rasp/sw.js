/* Офлайн: оболочка приложения из кэша, расписание — сначала из сети, без сети — последнее сохранённое. */
const V = "20261111103742";
const SHELL = "rasp-shell-" + V;
const CORE = ["./", "index.html", "css/app.css", "js/config.js", "js/pack.js", "js/app.js", "icons/logo.svg", "manifest.webmanifest"];
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => Promise.all(CORE.map((u) => c.add(new Request(u === "./" || u === "index.html" ? u : u + "?v=" + V, { cache: "reload" })).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rasp-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith("/data/schedule.json")) return; // расписание кэширует само приложение
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(SHELL).then((c) => c.put("index.html", copy));
          return r;
        })
        .catch(() => caches.match("index.html", { cacheName: SHELL }).then((r) => r || caches.match("./", { cacheName: SHELL }))),
    );
    return;
  }
  e.respondWith(
    caches.match(req, { cacheName: SHELL }).then(
      (hit) =>
        hit ||
        fetch(req).then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return r;
        }),
    ),
  );
});

/* уведомления о заменах (присылает сервер push/) */
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "Расписание КузТАГиС", {
      body: d.body || "Расписание изменилось.",
      tag: d.tag || "rasp",
      renotify: true,
      icon: "icons/icon-192.png",
      lang: "ru",
      data: { url: d.url || "./" },
    }),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list)
        if (c.url.startsWith(self.registration.scope) && "focus" in c) {
          c.postMessage("rasp-reload");
          return c.focus();
        }
      return self.clients.openWindow(url);
    }),
  );
});
