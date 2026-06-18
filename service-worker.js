/* ==========================================================================
   Service Worker - 支持离线打开
   策略：
     - 安装时预缓存核心静态资源 (app shell)
     - 同源静态资源（HTML/JS/CSS）：stale-while-revalidate → 先显示缓存，后台悄悄拉取新版本
     - 图片等资源：缓存优先（变化小）
     - 接口请求（/chat /messages 等）：不缓存，直接走网络
   ========================================================================== */

var CACHE_NAME = 'health-assistant-v20260618-4';
var PRECACHE_URLS = [
  './index.html',
  './style.css',
  './app.js',
  './env.js',
  './manifest.json'
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

  // ⭐ 接口请求：不走缓存（所有 /api/* 下的路径）
  if (url.pathname.indexOf('/chat') !== -1 ||
      url.pathname.indexOf('/messages') !== -1 ||
      url.pathname.indexOf('/food-logs') !== -1 ||
      url.pathname.indexOf('/health') !== -1 ||
      url.pathname.indexOf('/tools') !== -1 ||
      url.pathname.indexOf('/profile') !== -1 ||
      url.pathname.indexOf('/meal-history') !== -1) {
    return;
  }

  // ⭐ 同源静态资源（HTML/JS/CSS）：stale-while-revalidate
  // 先返回缓存，后台再拉取新版本写入缓存，下次刷新生效
  if (url.origin === location.origin) {
    var isHTML = url.pathname === '/' ||
                 url.pathname.endsWith('.html') ||
                 req.mode === 'navigate';
    var isJS = url.pathname.endsWith('.js');
    var isCSS = url.pathname.endsWith('.css');
    var isStatic = isHTML || isJS || isCSS;
    
    if (isStatic) {
      event.respondWith(
        caches.open(CACHE_NAME).then(function (cache) {
          return cache.match(req).then(function (cached) {
            var networkFetch = fetch(req).then(function (resp) {
              // 成功响应才写入缓存
              if (resp && resp.status === 200 && resp.type === 'basic') {
                cache.put(req, resp.clone());
              }
              return resp;
            }).catch(function () {
              return cached; // 网络失败时返回缓存
            });
            return cached || networkFetch;
          });
        })
      );
      return;
    }
  }

  // 其他同源资源（图片等）：缓存优先
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(function (resp) {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(req, clone);
            });
          }
          return resp;
        }).catch(function () {
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
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
