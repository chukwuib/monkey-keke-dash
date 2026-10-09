// Monkey Keke Dash — PWA service worker.
// tools_buildweb.cjs fills in VERSION and PRECACHE when it copies this file
// into www/, so every build gets a fresh cache and old ones are dropped.
const VERSION = '20261009110654';
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/core/AudioManager.js",
  "./js/core/DailyReward.js",
  "./js/core/GameManager.js",
  "./js/core/InputManager.js",
  "./js/core/Leaderboard.js",
  "./js/core/PaymentManager.js",
  "./js/core/Stats.js",
  "./js/data/Products.js",
  "./js/data/StatesData.js",
  "./js/entities/Player.js",
  "./js/entities/PoliceChaser.js",
  "./js/main.js",
  "./js/managers/CoinManager.js",
  "./js/managers/MissionManager.js",
  "./js/managers/ObstacleManager.js",
  "./js/managers/PowerUpManager.js",
  "./js/managers/ShopManager.js",
  "./js/ui/UIManager.js",
  "./js/world/Road.js",
  "./node_modules/three/build/three.module.js",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./assets/img/icon-maskable-512.png",
  "./assets/img/apple-touch-icon.png"
]; // app shell: html, css, js, three, manifest, icons
const SHELL_CACHE = `mkd-shell-${VERSION}`;
const ASSET_CACHE = `mkd-assets-${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('mkd-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Leaderboard (Supabase) and other origins go straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Video/audio seek requests (Range → 206) can't be cached; let them through.
  if (request.headers.has('range')) return;

  // Images / audio / video: cache-first, filled the first time they're used.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(res => {
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then(c => c.put(request, copy));
        }
        return res;
      }))
    );
    return;
  }

  // App code: network-first so updates land immediately, cache when offline.
  event.respondWith(
    fetch(request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(request, copy));
      }
      return res;
    }).catch(() => caches.match(request, { ignoreSearch: true })
      .then(hit => hit || (request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
