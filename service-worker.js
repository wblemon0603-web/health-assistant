/* ==========================================================================
   Service Worker - 支持离线打开
   策略：
     - 安装时预缓存核心静态资源 (app shell)
     - 运行时对同源静态资源：缓存优先，回退到网络
     - 跨源资源（CDN marked/dompurify）：stale-while-revalidate
     - 接口请求（/chat）：不缓存，直接走网络
   ========================================================================== */

var CACHE_NAME = 'health-assistant-v1';
var PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './env.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ---------- 安装：预缓存 ----------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function (err) {
        console.warn('SW 预缓存部分资源失败：', err);
      });
    }).then(function () {
      return self.skipWaiting(); // 立即激活新的 SW
    })
  );
});

// ---------- 激活：清理旧缓存 ----------
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim(); // 立刻接管当前页面
    })
  );
});

// ---------- 请求拦截：按策略处理 ----------
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // 只处理 GET 请求
  if (req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 接口请求：不走缓存
  if (url.pathname.indexOf('/chat') !== -1) {
    return;
  }

  // 同源资源：缓存优先，缓存没有再走网络
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(function (resp) {
          // 成功响应才写入缓存
          if (resp && resp.status === 200 && resp.type === 'basic') {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(req, clone);
            });
          }
          return resp;
        }).catch(function () {
          // 离线时导航请求回退到 index.html
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          throw new Error('offline');
        });
      })
    );
    return;
  }

  // 跨源资源（如 CDN）：stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var network = fetch(req).then(function (resp) {
          if (resp && resp.status === 200) {
            cache.put(req, resp.clone());
          }
          return resp;
        }).catch(function () {
          return cached;
        });
        return cached || network;
      });
    })
  );
});
