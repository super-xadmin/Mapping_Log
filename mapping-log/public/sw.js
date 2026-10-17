// Service worker: เปิดหน้าแอปได้แม้ไม่มีสัญญาณ (ไม่แคช /api และไม่แคชแผนที่)
const CACHE = "mlog-shell-v2";
const STATIC = ["/manifest.webmanifest", "/icon-192.png", "/icon.svg"];

/** เก็บหน้า index.html และไฟล์ /assets/ ที่หน้านั้นใช้ แล้วลบไฟล์เวอร์ชันเก่าออก */
async function cacheShell(htmlResponse) {
  const cache = await caches.open(CACHE);
  const html = await htmlResponse.clone().text();
  await cache.put("/", htmlResponse);
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
  const missing = [];
  for (const a of [...assets, ...STATIC]) if (!(await cache.match(a))) missing.push(a);
  if (missing.length) await cache.addAll(missing);
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (p.startsWith("/assets/") && !assets.includes(p)) await cache.delete(req);
  }
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    fetch("/", { cache: "no-store" })
      .then((res) => (res.ok ? cacheShell(res) : undefined))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // หน้าเว็บ: ใช้เวอร์ชันล่าสุดจากเน็ตก่อน ถ้าออฟไลน์ใช้ที่แคชไว้
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
            e.waitUntil(cacheShell(res.clone()).catch(() => {}));
          }
          return res;
        })
        .catch(async () => (await caches.match("/")) || Response.error()),
    );
    return;
  }

  // ไฟล์ที่ build แล้ว (ชื่อไฟล์มี hash) และไอคอน: ใช้จากแคชก่อน
  if (url.pathname.startsWith("/assets/") || STATIC.includes(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
