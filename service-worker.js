/* ==========================================================================
   Service Worker - 支持离线打开(v4 网络优先版)
   策略:
     - HTML / JS / CSS:网络优先(network-first),保证每次刷新都拿最新代码
     - 图片等静态资源:缓存优先(变化小,省流量)
     - 接口请求:不缓存,直接走网络
   每次部署只需要改下面的 BUILD_ID(或用构建脚本注入时间戳)即可强制更新
   ========================================================================== */

var BUILD_ID = '20260618-3';                           // ← 每次部署改这一行
var CACHE_NAME = 'health-assistant-' + BUILD_ID;
var PRECACHE_URLS = [
  './index.html',
  './style.css',
  './app.js',
  './env.js',
  './manifest.json'
];

// 接口路径前缀(精确匹配,避免误伤)
var API_PREFIXES = [
  '/api/',
  '/chat',
  '/messages',
  '/food-logs',
  '/health',
  '/tools',
  '/profile',
  '/meal-history'
];

function isApiRequest(pathname) {
  for (var i = 0; i < API_PREFIXES.length; i++) {
    if (pathname.indexOf(API_PREFIXES[i]) === 0 ||
        pathname.indexOf('/api' + API_PREFIXES[i]) === 0) {
      return true;
    }
  }
  return false;
}

// ---------- 安装:预缓存 ----------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function (err) {
        console.warn('[SW] 预缓存失败:', err);
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ---------- 激活:清理所有旧版本缓存 ----------
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) {
            console.log('[SW] 清理旧缓存:', key);
            return caches.delete(key);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ---------- 请求拦截 ----------
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // 只处理 GET
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 跳过非 http(s) 请求(chrome-extension:// 等)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // ⭐ 接口请求:不缓存
  if (isApiRequest(url.pathname)) return;

  // 只接管同源请求
  if (url.origin !== location.origin) return;

  var isHTML = url.pathname === '/' ||
               url.pathname.endsWith('.html') ||
               req.mode === 'navigate';
  var isJS = url.pathname.endsWith('.js');
  var isCSS = url.pathname.endsWith('.css');
  var isCode = isHTML || isJS || isCSS;

  if (isCode) {
    // 🔥 网络优先:确保每次刷新都拿最新代码,离线才用缓存
    event.respondWith(networkFirst(req));
  } else {
    // 图片等静态资源:缓存优先
    event.respondWith(cacheFirst(req));
  }
});

// 网络优先策略
function networkFirst(req) {
  return fetch(req).then(function (resp) {
    if (resp && resp.status === 200 && resp.type === 'basic') {
      var clone = resp.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(req, clone);
      });
    }
    return resp;
  }).catch(function () {
    // 离线兜底:从缓存里取;HTML 兜底到 index.html
    return caches.match(req).then(function (cached) {
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  });
}

// 缓存优先策略
function cacheFirst(req) {
  return caches.match(req).then(function (cached) {
    if (cached) return cached;
    return fetch(req).then(function (resp) {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, clone);
        });
      }
      return resp;
    }).catch(function () {
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  });
}

// ---------- 接收页面消息:支持手动触发更新 ----------
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});