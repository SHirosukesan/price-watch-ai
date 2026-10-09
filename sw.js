// Price Watch シンプルshiro_AI — オフライン対応と通知クリック
// 方針: いつも最新をネットから取り、つながらないときだけ保存済みのものを使う。
// 画面のファイルを変えたら VERSION の数字を1つ上げてください。
const VERSION = "pw-v2";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        const key = url.pathname.endsWith(".json") ? new Request(url.origin + url.pathname) : e.request;
        caches.open(VERSION).then((c) => c.put(key, copy));
        return res;
      })
      .catch(() => caches.match(new Request(url.origin + url.pathname)).then((r) => r || caches.match(e.request)))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./";
  e.waitUntil(self.clients.openWindow(url));
});
