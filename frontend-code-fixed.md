# 健康助手 · 前端完整代码（修复版）

> 修复时间：2026-06-16
> 移动端健康助手聊天 Web App - iMessage 风格 UI + PWA 支持
> 配合后端修复版使用

---

## 🔥 本次修复内容

| # | 改动 | 原因 |
|---|---|---|
| 1 | callChatApi 接收并返回 `food_logged` / `tool_errors` / `used_tools` | 让前端能看到饮食是否真的入库 |
| 2 | AI 气泡下方新增"已记录 / 记录失败"小标签 | 用户和开发者一眼可见 |
| 3 | 错误时透传完整错误信息（含 reply body 文本） | 不再只显示 `HTTP 500`，方便排查 |
| 4 | 顶部新增"今日饮食"按钮 + 弹层 | 一键查 `/api/food-logs`，验证数据是否入库 |
| 5 | 新增"诊断"按钮 → 调 `/api/health` | 一键检查后端 + 数据库状态 |
| 6 | 默认环境从 `prod` 改为根据域名判断更稳健 | 见 env.js 注释 |

---

## 📁 文件结构

```
health-assistant-frontend/
├── index.html
├── style.css
├── app.js
├── env.js
├── manifest.json
├── service-worker.js
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## 🔌 后端接口约定

| 接口 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/chat` | POST | `{ message, session_id, image_url? }` | `{ reply, used_tools, food_logged, tool_errors, ... }` |
| `/api/messages/save` | POST | `{ role, content, session_id, image_url? }` | `{ success, message_id }` |
| `/api/messages/history` | GET | `?session_id=&limit=` | `{ messages: [...] }` |
| `/api/food-logs` | GET | `?date=YYYY-MM-DD`（不传默认今天） | `{ date, total_calories, target_calories, logs: [...] }` |
| `/api/health` | GET | - | `{ ok, db: {...}, today_beijing, ... }` |

---

## 📄 1. index.html（修改版）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="#f7f7f7" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="健康助手" />

  <title>健康助手</title>

  <link rel="manifest" href="./manifest.json" />
  <link rel="apple-touch-icon" href="./icons/icon-192.png" />
  <link rel="stylesheet" href="./style.css" />

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js" defer></script>
</head>
<body>
  <!-- 顶部导航栏 -->
  <header class="app-header">
    <div class="app-header__inner">
      <button id="foodLogBtn" class="app-header__action app-header__action--left" type="button" title="今日饮食">🍽</button>
      <h1 class="app-header__title">健康助手</h1>
      <span id="envBadge" class="env-badge" title="当前后端环境">生产</span>
      <button id="clearBtn" class="app-header__action" type="button" title="清空消息">清空</button>
    </div>
  </header>

  <!-- 消息列表 -->
  <main id="chat" class="chat-list" aria-live="polite"></main>

  <!-- 底部输入栏 -->
  <footer class="chat-input-bar">
    <input id="imageInput" type="file" accept="image/*" capture="environment" class="chat-input-bar__file" />

    <button id="imageBtn" type="button" class="chat-input-bar__icon" aria-label="上传图片或拍照" title="拍照 / 相册">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <path fill="currentColor" d="M20 5h-3.2l-1.4-2.1A1 1 0 0 0 14.5 2h-5a1 1 0 0 0-.9.6L7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-8 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
      </svg>
    </button>

    <form id="chatForm" class="chat-input-bar__form">
      <input id="messageInput" type="text" class="chat-input-bar__text" placeholder="发消息..." autocomplete="off" enterkeyhint="send" />
      <button id="sendBtn" type="submit" class="chat-input-bar__send" aria-label="发送">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M3.4 20.5 21 12 3.4 3.5 3 10l12 2-12 2z" />
        </svg>
      </button>
    </form>

    <div id="imagePreview" class="image-preview" hidden>
      <img id="imagePreviewImg" alt="待发送图片" />
      <button id="imageRemove" type="button" class="image-preview__remove" aria-label="移除图片">×</button>
    </div>
  </footer>

  <!-- 今日饮食弹层 -->
  <div id="foodModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="1"></div>
    <div class="modal__card">
      <div class="modal__header">
        <h3 class="modal__title">今日饮食</h3>
        <button class="modal__close" data-close="1" aria-label="关闭">×</button>
      </div>
      <div id="foodModalBody" class="modal__body">加载中...</div>
    </div>
  </div>

  <script src="./env.js"></script>
  <script src="./app.js" defer></script>

  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./service-worker.js').catch(function (err) {
          console.warn('SW 注册失败：', err);
        });
      });
    }
  </script>
</body>
</html>
```

---

## 📄 2. style.css（在原版基础上追加）

> 新增：`.app-header__action--left`、`.modal`、`.msg__meta`、`.msg__meta--ok`、`.msg__meta--fail`

```css
/* ==========================================================================
   健康助手聊天界面 - iMessage 风格
   ========================================================================== */

:root {
  --color-bg: #f7f7f7;
  --color-header-bg: rgba(247, 247, 247, 0.85);
  --color-header-border: #d1d1d6;
  --color-text: #1c1c1e;
  --color-muted: #8e8e93;
  --color-user-bubble: #007aff;
  --color-user-bubble-text: #ffffff;
  --color-ai-bubble: #e9e9eb;
  --color-ai-bubble-text: #1c1c1e;
  --color-input-bg: #ffffff;
  --color-input-border: rgba(60, 60, 67, 0.18);
  --color-send-bg: #007aff;
  --color-send-bg-disabled: #c7c7cc;
  --color-send-text: #ffffff;
  --color-ok: #00a870;
  --color-fail: #ff3b30;
  --radius-bubble: 20px;
  --radius-input: 22px;
  --shadow-soft: 0 1px 2px rgba(0, 0, 0, 0.04);
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --font-size-base: 16px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #000000;
    --color-header-bg: rgba(22, 22, 23, 0.85);
    --color-header-border: rgba(84, 84, 88, 0.65);
    --color-text: #ffffff;
    --color-ai-bubble: #2c2c2e;
    --color-ai-bubble-text: #ffffff;
    --color-input-bg: #1c1c1e;
    --color-input-border: rgba(84, 84, 88, 0.65);
  }
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", "Segoe UI", Roboto, Arial, sans-serif;
  font-size: var(--font-size-base);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
}

button { font-family: inherit; border: none; background: transparent; cursor: pointer; color: inherit; }
input { font-family: inherit; }

body { display: flex; flex-direction: column; }

/* ==== 顶部导航栏 ==== */
.app-header {
  position: sticky; top: 0; z-index: 10;
  background: var(--color-header-bg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid var(--color-header-border);
  padding-top: var(--safe-top);
}

.app-header__inner {
  height: 48px; display: flex; align-items: center; justify-content: center;
  position: relative; padding: 0 12px;
}

.app-header__title { margin: 0; font-size: 17px; font-weight: 600; }

.app-header__action {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  font-size: 14px; color: var(--color-user-bubble);
  padding: 6px 8px; border-radius: 8px;
}

/* ⭐ 新增：左侧按钮 */
.app-header__action--left {
  right: auto; left: 12px;
  font-size: 18px;
}

.app-header__action:active { background: rgba(0, 122, 255, 0.12); }

/* ==== 消息列表 ==== */
.chat-list {
  flex: 1 1 auto; overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 12px 16px;
  display: flex; flex-direction: column; gap: 8px;
}

.msg { display: flex; flex-direction: column; max-width: 100%; }
.msg--user { align-items: flex-end; }
.msg--ai { align-items: flex-start; }

.msg__bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: var(--radius-bubble);
  word-wrap: break-word; word-break: break-word;
  box-shadow: var(--shadow-soft);
  position: relative;
  animation: bubble-in 0.2s ease-out;
  font-size: 15px; line-height: 1.45;
}

.msg--user .msg__bubble {
  background: var(--color-user-bubble);
  color: var(--color-user-bubble-text);
  border-bottom-right-radius: 6px;
}

.msg--ai .msg__bubble {
  background: var(--color-ai-bubble);
  color: var(--color-ai-bubble-text);
  border-bottom-left-radius: 6px;
}

/* ⭐ 新增：消息下方的小标签（已记录/失败） */
.msg__meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-muted);
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.msg__meta--ok { color: var(--color-ok); }
.msg__meta--fail { color: var(--color-fail); }

@keyframes bubble-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.msg__bubble img.msg-image {
  display: block; max-width: 100%; border-radius: 12px; margin: 6px 0;
}

/* ==== Markdown ==== */
.msg__content p { margin: 0; }
.msg__content p + p { margin-top: 6px; }
.msg--ai .msg__content a { color: var(--color-user-bubble); }
.msg--user .msg__content a { color: #fff; text-decoration: underline; }
.msg__content table { border-collapse: collapse; margin: 6px 0; width: 100%; font-size: 13px; }
.msg__content th, .msg__content td {
  border: 1px solid rgba(127, 127, 127, 0.3); padding: 4px 8px; text-align: left;
}
.msg__content th { background: rgba(127, 127, 127, 0.15); font-weight: 600; }
.msg__content code {
  background: rgba(127, 127, 127, 0.2); padding: 1px 5px; border-radius: 4px; font-size: 0.9em;
}
.msg__content pre {
  background: rgba(0, 0, 0, 0.05); padding: 8px 10px; border-radius: 8px; overflow-x: auto;
}
.msg__content pre code { background: transparent; padding: 0; }
.msg__content ul, .msg__content ol { margin: 4px 0 4px 20px; padding: 0; }

/* ==== 打字动画 ==== */
.typing { display: inline-flex; align-items: center; gap: 4px; color: var(--color-muted); font-size: 14px; }
.typing__dots { display: inline-flex; gap: 3px; }
.typing__dots span {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-muted); opacity: 0.5;
  animation: typing-bounce 1.2s infinite;
}
.typing__dots span:nth-child(2) { animation-delay: 0.15s; }
.typing__dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* ==== 输入栏 ==== */
.chat-input-bar {
  background: var(--color-header-bg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 1px solid var(--color-header-border);
  padding: 8px 10px calc(8px + var(--safe-bottom));
  position: sticky; bottom: 0; z-index: 10;
}
.chat-input-bar__file { display: none; }
.chat-input-bar__icon {
  padding: 8px; color: var(--color-user-bubble);
  border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
}
.chat-input-bar__icon:active { background: rgba(0, 122, 255, 0.12); }
.chat-input-bar__form { display: flex; align-items: center; gap: 8px; }
.chat-input-bar__text {
  flex: 1 1 auto;
  border: 1px solid var(--color-input-border);
  background: var(--color-input-bg);
  color: var(--color-text);
  border-radius: var(--radius-input);
  padding: 10px 16px;
  font-size: 16px;
  outline: none;
  min-width: 0;
}
.chat-input-bar__text:focus {
  border-color: var(--color-user-bubble);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
}
.chat-input-bar__send {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--color-send-bg); color: var(--color-send-text);
  display: inline-flex; align-items: center; justify-content: center;
  transition: transform 0.1s ease, background 0.2s ease;
  flex: 0 0 auto;
}
.chat-input-bar__send:disabled { background: var(--color-send-bg-disabled); cursor: not-allowed; }
.chat-input-bar__send:not(:disabled):active { transform: scale(0.92); }

/* ==== 图片预览 ==== */
.image-preview { position: relative; margin-top: 6px; padding-left: 4px; }
.image-preview img { max-height: 90px; border-radius: 12px; display: block; }
.image-preview__remove {
  position: absolute; top: -6px; left: 72px;
  background: rgba(0, 0, 0, 0.6); color: #fff;
  width: 22px; height: 22px; border-radius: 50%;
  font-size: 16px; line-height: 22px; padding: 0;
}

/* ==== 桌面端 ==== */
@media (min-width: 640px) {
  body { background: #e5e5ea; align-items: center; }
  .app-header, .chat-list, .chat-input-bar { width: 100%; max-width: 480px; }
  .app-header, .chat-input-bar {
    border-left: 1px solid var(--color-header-border);
    border-right: 1px solid var(--color-header-border);
  }
  .chat-list { background: var(--color-bg); }
  .modal__card { max-width: 460px; }
}

/* ==== 环境标识 ==== */
.env-badge {
  display: inline-block;
  padding: 3px 10px; margin: 0 8px;
  font-size: 12px; font-weight: 500;
  color: #fff; background-color: #00a870;
  border-radius: 10px; cursor: pointer; user-select: none;
  letter-spacing: 0.5px; opacity: 0.9;
  transition: opacity 0.2s ease;
}
.env-badge:hover { opacity: 1; }
.env-badge::before {
  content: ''; display: inline-block;
  width: 6px; height: 6px; margin-right: 6px;
  background: #fff; border-radius: 50%; vertical-align: middle;
}

/* ⭐ 新增：弹层 */
.modal {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.modal[hidden] { display: none; }
.modal__backdrop {
  position: absolute; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}
.modal__card {
  position: relative;
  width: 100%; max-width: 100%;
  max-height: 80vh; overflow: hidden;
  background: var(--color-input-bg);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  display: flex; flex-direction: column;
}
.modal__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-input-border);
}
.modal__title { margin: 0; font-size: 16px; font-weight: 600; }
.modal__close {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(127, 127, 127, 0.15);
  font-size: 18px; line-height: 28px; padding: 0;
}
.modal__body {
  padding: 14px 16px; overflow-y: auto;
  font-size: 14px;
}
.food-stat {
  display: flex; gap: 12px; margin-bottom: 12px;
  padding: 12px; border-radius: 10px;
  background: rgba(0, 168, 112, 0.08);
}
.food-stat--over { background: rgba(255, 59, 48, 0.08); }
.food-stat__item { flex: 1; text-align: center; }
.food-stat__num { font-size: 18px; font-weight: 600; }
.food-stat__label { font-size: 11px; color: var(--color-muted); margin-top: 2px; }
.food-log-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--color-input-border);
}
.food-log-item:last-child { border-bottom: none; }
.food-log-item__meal {
  display: inline-block;
  padding: 2px 8px; border-radius: 6px;
  background: var(--color-user-bubble); color: #fff;
  font-size: 11px; margin-right: 8px;
}
.food-log-item__cal {
  float: right; font-weight: 600;
  color: var(--color-user-bubble);
}
.food-log-item__list {
  margin-top: 6px; padding-left: 0;
  font-size: 13px; color: var(--color-muted);
  list-style: none;
}
.food-log-item__list li { padding: 2px 0; }
```

---

## 📄 3. app.js（核心修改）

```javascript
/* ==========================================================================
   健康助手 - 前端主逻辑（修复版）
   ========================================================================== */

(function () {
  'use strict';

  // ----- 常量 -----
  var STORAGE_KEY = 'health_assistant_messages_v1';
  var SESSION_KEY = 'health_assistant_session_id';

  // 从 env.js 读取
  var cfg = window.__HELPER_CONFIG__ || {
    env: 'prod',
    API_URL: 'https://tswpbzbxdx.coze.site/api/chat',
    HISTORY_API_URL: 'https://tswpbzbxdx.coze.site/api/messages',
    API_BASE: 'https://tswpbzbxdx.coze.site/api'
  };
  var API_URL = cfg.API_URL;
  var HISTORY_API_URL = cfg.HISTORY_API_URL;
  var API_BASE = cfg.API_BASE;

  // ----- 状态 -----
  var pendingImageDataUrl = null;
  var isWaiting = false;
  var typingEl = null;

  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  var messages = [];

  // ==========================================================================
  // 本地缓存
  // ==========================================================================

  function loadMessagesFromLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function saveMessagesToLocal(msgList) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgList)); } catch (e) {}
  }

  // ==========================================================================
  // 云端
  // ==========================================================================

  function loadMessagesFromCloud() {
    var url = HISTORY_API_URL + '/history?session_id=' +
      encodeURIComponent(sessionId) + '&limit=100';
    return fetch(url, { method: 'GET' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var cloudMessages = data && Array.isArray(data.messages) ? data.messages : [];
        return cloudMessages.map(function (m) {
          return {
            role: m.role === 'assistant' ? 'ai' : 'user',
            text: m.content || '',
            image: m.image_url || null,
            ts: new Date(m.timestamp || Date.now()).getTime(),
            cloudId: m.id || null
          };
        });
      })
      .catch(function (err) {
        console.warn('[云端] 加载历史失败:', err.message);
        return null;
      });
  }

  function saveMessageToCloud(msg) {
    var payload = {
      role: msg.role === 'ai' ? 'assistant' : 'user',
      content: msg.text || '',
      session_id: sessionId,
      image_url: msg.image || null
    };

    return fetch(HISTORY_API_URL + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.message_id) msg.cloudId = data.message_id;
        return msg;
      })
      .catch(function (err) {
        console.warn('[云端] 保存失败:', err.message);
        return msg;
      });
  }

  // ==========================================================================
  // 渲染
  // ==========================================================================

  function renderMarkdown(text) {
    var html = '';
    if (window.marked) {
      try {
        html = typeof window.marked.parse === 'function'
          ? window.marked.parse(text) : window.marked(text);
      } catch (e) { html = escapeHtml(text); }
    } else {
      html = escapeHtml(text);
    }
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
    return html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createMessageEl(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'msg msg--' + msg.role;
    var bubble = document.createElement('div');
    bubble.className = 'msg__bubble';

    if (msg.image) {
      var img = document.createElement('img');
      img.className = 'msg-image';
      img.alt = '图片';
      img.src = msg.image;
      bubble.appendChild(img);
    }

    if (msg.text) {
      var content = document.createElement('div');
      content.className = 'msg__content';
      if (msg.role === 'ai') {
        content.innerHTML = renderMarkdown(msg.text);
      } else {
        content.innerHTML = escapeHtml(msg.text).replace(/\n/g, '<br/>');
      }
      bubble.appendChild(content);
    }

    wrap.appendChild(bubble);

    // ⭐ 新增：AI 消息下方的工具执行小标签
    if (msg.role === 'ai' && msg.meta) {
      var meta = document.createElement('div');
      meta.className = 'msg__meta ' +
        (msg.meta.kind === 'ok' ? 'msg__meta--ok' :
         msg.meta.kind === 'fail' ? 'msg__meta--fail' : '');
      meta.textContent = msg.meta.text;
      wrap.appendChild(meta);
    }

    return wrap;
  }

  function showTyping() {
    if (typingEl) return;
    var wrap = document.createElement('div');
    wrap.className = 'msg msg--ai';
    var bubble = document.createElement('div');
    bubble.className = 'msg__bubble';
    bubble.innerHTML =
      '<span class="typing">AI 正在输入' +
      '<span class="typing__dots"><span></span><span></span><span></span></span></span>';
    wrap.appendChild(bubble);
    document.getElementById('chat').appendChild(wrap);
    typingEl = wrap;
    scrollToBottom();
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  function scrollToBottom() {
    var chatEl = document.getElementById('chat');
    window.requestAnimationFrame(function () { chatEl.scrollTop = chatEl.scrollHeight; });
  }

  function renderAll() {
    var chatEl = document.getElementById('chat');
    chatEl.innerHTML = '';
    messages.forEach(function (m) { chatEl.appendChild(createMessageEl(m)); });
    scrollToBottom();
  }

  function renderNewMessage(msg) {
    document.getElementById('chat').appendChild(createMessageEl(msg));
    scrollToBottom();
  }

  // ==========================================================================
  // 发送消息（⭐ 关键改造）
  // ==========================================================================

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  /**
   * ⭐ 修复：返回完整结构，让上层能拿到 food_logged / tool_errors
   */
  function callChatApi(text, imageDataUrl) {
    var payload = { message: text || '', session_id: sessionId };
    if (imageDataUrl) payload.image_url = imageDataUrl;

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.text().then(function (rawText) {
          if (!res.ok) {
            // ⭐ 修复：把后端的错误正文也透传出来
            var snippet = rawText ? rawText.slice(0, 300) : '';
            throw new Error('HTTP ' + res.status + (snippet ? ' — ' + snippet : ''));
          }
          try { return JSON.parse(rawText); }
          catch (e) { throw new Error('响应不是合法 JSON: ' + rawText.slice(0, 200)); }
        });
      })
      .then(function (data) {
        return {
          reply: (data && (data.reply || data.message || data.content)) || '（无回复内容）',
          usedTools: (data && data.used_tools) || [],
          foodLogged: !!(data && data.food_logged),
          toolErrors: (data && data.tool_errors) || []
        };
      });
  }

  function sendMessage(text, imageDataUrl) {
    if (isWaiting) return;
    if (!text && !imageDataUrl) return;

    isWaiting = true;
    setInputDisabled(true);

    var userMsg = { role: 'user', text: text || '', image: imageDataUrl || null, ts: Date.now() };
    messages.push(userMsg);
    saveMessagesToLocal(messages);
    renderNewMessage(userMsg);
    saveMessageToCloud(userMsg);

    showTyping();

    callChatApi(text, imageDataUrl)
      .then(function (result) {
        hideTyping();

        // ⭐ 构造 meta 信息显示在 AI 气泡下方
        var meta = null;
        if (result.foodLogged) {
          meta = { kind: 'ok', text: '✓ 已记录到今日饮食' };
        } else if (result.toolErrors && result.toolErrors.length > 0) {
          // 检测到漏记录的情况
          var hasFoodIntent = result.toolErrors.some(function (e) {
            return e.indexOf('detected_food_intent') !== -1;
          });
          if (hasFoodIntent) {
            meta = { kind: 'fail', text: '⚠ 似乎在记饮食但未能写入，可手动点 🍽 查看' };
          } else {
            meta = { kind: 'fail', text: '⚠ 工具失败: ' + result.toolErrors.join('; ') };
          }
        } else if (result.usedTools && result.usedTools.length > 0) {
          meta = { kind: 'info', text: '已使用工具: ' + result.usedTools.join(', ') };
        }

        var aiMsg = {
          role: 'ai',
          text: result.reply,
          image: null,
          ts: Date.now(),
          meta: meta
        };
        messages.push(aiMsg);
        saveMessagesToLocal(messages);
        renderNewMessage(aiMsg);
        saveMessageToCloud(aiMsg);
      })
      .catch(function (err) {
        console.error('调用接口失败:', err);
        hideTyping();
        var errMsg = {
          role: 'ai',
          text: '⚠️ 抱歉，暂时无法连接到服务。\n\n错误：' + err.message +
                '\n\n可点击顶部 🍽 旁试试，或在 URL 后加 `?env=dev` 切换到开发环境。',
          ts: Date.now(),
          meta: { kind: 'fail', text: '请求失败' }
        };
        messages.push(errMsg);
        saveMessagesToLocal(messages);
        renderNewMessage(errMsg);
      })
      .then(function () {
        isWaiting = false;
        setInputDisabled(false);
        var inputEl = document.getElementById('messageInput');
        if (inputEl) inputEl.focus();
      });
  }

  function setInputDisabled(disabled) {
    var inputEl = document.getElementById('messageInput');
    var sendBtnEl = document.getElementById('sendBtn');
    if (inputEl) inputEl.disabled = disabled;
    if (sendBtnEl) sendBtnEl.disabled = disabled;
  }

  // ==========================================================================
  // ⭐ 新增：今日饮食查看（自检入口）
  // ==========================================================================

  function fetchTodayFoodLogs() {
    var url = API_BASE + '/food-logs';  // 不传 date 默认查今天
    return fetch(url, { method: 'GET' })
      .then(function (res) {
        return res.text().then(function (raw) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + raw.slice(0, 200));
          return JSON.parse(raw);
        });
      });
  }

  function renderFoodLogModal(data) {
    var body = document.getElementById('foodModalBody');
    if (!data) {
      body.innerHTML = '<p style="color:var(--color-muted)">没有数据</p>';
      return;
    }

    var total = data.total_calories || 0;
    var target = data.target_calories || 1750;
    var remaining = target - total;
    var isOver = remaining < 0;

    var html = '';
    html += '<div class="food-stat ' + (isOver ? 'food-stat--over' : '') + '">';
    html += '  <div class="food-stat__item"><div class="food-stat__num">' + total + '</div><div class="food-stat__label">已摄入 kcal</div></div>';
    html += '  <div class="food-stat__item"><div class="food-stat__num">' + target + '</div><div class="food-stat__label">每日目标</div></div>';
    html += '  <div class="food-stat__item"><div class="food-stat__num">' + (isOver ? '超 ' + (-remaining) : remaining) + '</div><div class="food-stat__label">' + (isOver ? '超出' : '剩余') + ' kcal</div></div>';
    html += '</div>';
    html += '<p style="color:var(--color-muted);font-size:12px;margin-bottom:8px">日期：' + (data.date || '今天') + '</p>';

    var logs = data.logs || [];
    if (logs.length === 0) {
      html += '<p style="color:var(--color-muted);text-align:center;padding:20px 0">' +
              '今天还没有饮食记录<br/><br/>' +
              '<small>试试在对话里说"我中午吃了一份番茄炒蛋盖饭"</small>' +
              '</p>';
    } else {
      logs.forEach(function (log) {
        var mealLabel = {
          breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐'
        }[log.meal_type] || log.meal_type;
        html += '<div class="food-log-item">';
        html += '  <span class="food-log-item__meal">' + mealLabel + '</span>';
        html += '  <span class="food-log-item__cal">' + log.calories + ' kcal</span>';
        if (Array.isArray(log.food_items)) {
          html += '  <ul class="food-log-item__list">';
          log.food_items.forEach(function (item) {
            html += '<li>· ' + escapeHtml(item.name) + ' (' + escapeHtml(item.amount || '') + ') ' + item.calories + ' kcal</li>';
          });
          html += '  </ul>';
        }
        html += '</div>';
      });
    }

    body.innerHTML = html;
  }

  function openFoodModal() {
    var modal = document.getElementById('foodModal');
    var body = document.getElementById('foodModalBody');
    modal.hidden = false;
    body.innerHTML = '加载中...';
    fetchTodayFoodLogs()
      .then(renderFoodLogModal)
      .catch(function (err) {
        body.innerHTML = '<p style="color:var(--color-fail)">' +
          '❌ 加载失败<br/><br/>' + escapeHtml(err.message) +
          '<br/><br/><small>这通常意味着后端没启动、URL 配错、或 API 不存在</small></p>';
      });
  }

  function closeFoodModal() {
    document.getElementById('foodModal').hidden = true;
  }

  // ==========================================================================
  // 事件绑定
  // ==========================================================================

  function bindEvents() {
    var formEl = document.getElementById('chatForm');
    var inputEl = document.getElementById('messageInput');
    var imageInputEl = document.getElementById('imageInput');
    var imageBtnEl = document.getElementById('imageBtn');
    var imagePreviewEl = document.getElementById('imagePreview');
    var imagePreviewImgEl = document.getElementById('imagePreviewImg');
    var imageRemoveEl = document.getElementById('imageRemove');
    var clearBtnEl = document.getElementById('clearBtn');
    var foodLogBtnEl = document.getElementById('foodLogBtn');
    var foodModalEl = document.getElementById('foodModal');

    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = inputEl.value.trim();
      var image = pendingImageDataUrl;
      if (!text && !image) return;
      sendMessage(text, image);
      inputEl.value = '';
      clearPendingImage();
    });

    imageBtnEl.addEventListener('click', function () {
      imageInputEl.value = '';
      imageInputEl.click();
    });

    imageInputEl.addEventListener('change', function () {
      var file = imageInputEl.files && imageInputEl.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { alert('请选择图片文件'); return; }
      if (file.size > 8 * 1024 * 1024) { alert('图片过大（>8MB），请选择更小的图片'); return; }
      fileToDataUrl(file).then(function (dataUrl) {
        pendingImageDataUrl = dataUrl;
        imagePreviewImgEl.src = dataUrl;
        imagePreviewEl.hidden = false;
        inputEl.focus();
      }).catch(function (err) {
        console.error('读取图片失败:', err);
        alert('读取图片失败');
      });
    });

    imageRemoveEl.addEventListener('click', clearPendingImage);

    function clearPendingImage() {
      pendingImageDataUrl = null;
      imagePreviewEl.hidden = true;
      imagePreviewImgEl.removeAttribute('src');
      imageInputEl.value = '';
    }

    clearBtnEl.addEventListener('click', function () {
      if (!confirm('确定要清空所有聊天记录吗？')) return;
      messages = [];
      saveMessagesToLocal(messages);
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(SESSION_KEY, sessionId);
      clearPendingImage();
      renderAll();
    });

    // ⭐ 今日饮食按钮
    foodLogBtnEl.addEventListener('click', openFoodModal);
    // 长按"清空"调出诊断
    var pressTimer = null;
    clearBtnEl.addEventListener('touchstart', function () {
      pressTimer = setTimeout(runDiagnostics, 1500);
    });
    clearBtnEl.addEventListener('touchend', function () {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });
    clearBtnEl.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      runDiagnostics();
    });

    foodModalEl.addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.close) closeFoodModal();
    });
  }

  // ⭐ 诊断：调 /api/health
  function runDiagnostics() {
    var url = API_BASE + '/health';
    fetch(url).then(function (r) { return r.text(); }).then(function (raw) {
      alert('诊断结果（API: ' + API_BASE + '）\n\n' + raw);
    }).catch(function (err) {
      alert('诊断失败：' + err.message + '\n\nAPI: ' + API_BASE);
    });
  }

  // ==========================================================================
  // 初始化
  // ==========================================================================

  function init() {
    bindEvents();

    var envBadgeEl = document.getElementById('envBadge');
    if (envBadgeEl && cfg) {
      envBadgeEl.textContent = cfg.label || '';
      if (cfg.color) envBadgeEl.style.backgroundColor = cfg.color;
      envBadgeEl.addEventListener('click', function () {
        var target = cfg.env === 'dev' ? 'prod' : 'dev';
        var search = window.location.search;
        if (search.match(/[?&]env=/i)) {
          window.location.search = search.replace(/([?&])env=[^&]*/, '$1env=' + target);
        } else {
          window.location.search = (search ? search + '&' : '?') + 'env=' + target;
        }
      });
      envBadgeEl.title = '当前环境：' + (cfg.label || cfg.env) + '（点击切换）';
    }

    messages = loadMessagesFromLocal();
    if (messages.length === 0) {
      var welcome = {
        role: 'ai',
        text: '你好，我是你的健康助手 👋\n\n' +
              '试试这样跟我说：\n' +
              '· "我中午吃了一份番茄炒蛋盖饭"\n' +
              '· "上传一张食物照片"\n' +
              '· "今天吃了多少卡？"\n\n' +
              '点击左上角 🍽 可查看今日饮食记录。',
        ts: Date.now()
      };
      messages.push(welcome);
      saveMessagesToLocal(messages);
      saveMessageToCloud(welcome);
    }
    renderAll();

    loadMessagesFromCloud().then(function (cloudMsgs) {
      if (cloudMsgs && cloudMsgs.length > 0) {
        messages = cloudMsgs;
        saveMessagesToLocal(messages);
        renderAll();
      }
    });

    console.log('[健康助手] 就绪 | env=' + cfg.env + ' | session=' + sessionId + ' | API=' + API_BASE);
  }

  init();

  window.addEventListener('resize', function () { scrollToBottom(); });
})();
```

---

## 📄 4. env.js（修复版）

```javascript
// ============================================================
// 环境配置：开发环境 / 生产环境
// 修复点：
//   1. 暴露 API_BASE，方便 app.js 拼 /food-logs、/health
//   2. 默认环境判断更稳健（域名级判断）
// ============================================================

var DEV_API_BASE  = 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api';
var PROD_API_BASE = 'https://tswpbzbxdx.coze.site/api';

var ENV_CONFIG = {
  prod: {
    label: '生产',
    color: '#00a870',
    base: PROD_API_BASE
  },
  dev: {
    label: '开发',
    color: '#f5a623',
    base: DEV_API_BASE
  }
};

// 判断当前环境
var host = window.location.hostname;
var isLocalAccess = host === 'localhost' || host === '127.0.0.1' ||
                    /^\d+\.\d+\.\d+\.\d+$/.test(host);

var urlParamMatch = window.location.search.match(/[?&]env=(dev|prod)/i);
var envKey = urlParamMatch
  ? urlParamMatch[1].toLowerCase()
  : (isLocalAccess ? 'dev' : 'prod');

var picked = ENV_CONFIG[envKey];

// ⭐ 同时暴露 API_BASE
window.__HELPER_CONFIG__ = {
  env: envKey,
  label: picked.label,
  color: picked.color,
  API_BASE: picked.base,
  API_URL: picked.base + '/chat',
  HISTORY_API_URL: picked.base + '/messages'
};
```

---

## 📄 5. manifest.json（保持不变）

```json
{
  "name": "健康助手",
  "short_name": "健康助手",
  "description": "移动端健康助手聊天 Web App",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f7f7f7",
  "theme_color": "#f7f7f7",
  "lang": "zh-CN",
  "icons": [
    { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

---

## 📄 6. service-worker.js（增加 /health /food-logs 走网络）

```javascript
var CACHE_NAME = 'health-assistant-v2';  // ⭐ 改版本号触发更新
var PRECACHE_URLS = [
  './', './index.html', './style.css', './app.js',
  './env.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function (err) {
        console.warn('SW 预缓存失败：', err);
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // ⭐ 所有 API 请求都不缓存
  if (url.pathname.indexOf('/chat') !== -1 ||
      url.pathname.indexOf('/messages') !== -1 ||
      url.pathname.indexOf('/food-logs') !== -1 ||
      url.pathname.indexOf('/health') !== -1 ||
      url.pathname.indexOf('/tools') !== -1 ||
      url.pathname.indexOf('/profile') !== -1 ||
      url.pathname.indexOf('/meal-history') !== -1) {
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(function (resp) {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, clone); });
          }
          return resp;
        }).catch(function () {
          if (req.mode === 'navigate') return caches.match('./index.html');
          throw new Error('offline');
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var network = fetch(req).then(function (resp) {
          if (resp && resp.status === 200) cache.put(req, resp.clone());
          return resp;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
```

---

## 🚀 使用指南

### 验证步骤（按顺序）

1. **诊断后端**：
   - 鼠标右键 / 长按页面顶部"清空"按钮
   - 弹窗显示后端 `/api/health` 返回结果
   - 看 `db.ok` 是否 `true`、`today_beijing` 是否正确

2. **手动加一条饮食**：
   - 发消息："我中午吃了一份番茄炒蛋盖饭和一碗米饭"
   - AI 回复气泡下方应出现绿色 **✓ 已记录到今日饮食**
   - 如果出现 ⚠ → 说明后端工具调用没成功，按提示排查

3. **查看今日饮食**：
   - 点击左上角 🍽
   - 弹窗显示今日已摄入热量 / 目标 / 剩余 + 详细列表
   - 看到刚才的记录说明全链路 OK

### 常见问题对应表

| AI 气泡下方提示 | 含义 | 怎么办 |
|---|---|---|
| ✓ 已记录到今日饮食 | 写入成功 | 无需操作 |
| ⚠ 似乎在记饮食但未能写入 | AI 没调 log_food 工具 | 换种说法重发，或看后端日志 |
| ⚠ 工具失败: insertFoodLog ... | 数据库写入失败 | 检查 SERVICE_ROLE_KEY 是否配置 |
| 已使用工具: ... | 调用了非饮食工具 | 正常情况 |
| 请求失败 | 网络/接口异常 | 看错误内容 |

---

## 🔧 关键改造点汇总

| 文件 | 改动 | 行为变化 |
|---|---|---|
| index.html | 加 🍽 按钮 + foodModal | 一键查看今日饮食 |
| style.css | 加 `.msg__meta` `.modal` `.food-stat` 等 | 视觉反馈 + 弹层 |
| app.js | `callChatApi` 返回结构化对象 | 能拿到 `food_logged` |
| app.js | AI 气泡下方加 meta 标签 | 一眼看出是否记录成功 |
| app.js | 错误信息透传 body | 不再只看到 HTTP 500 |
| app.js | 新增 `fetchTodayFoodLogs` + `runDiagnostics` | 自助验证入口 |
| env.js | 暴露 `API_BASE` | 统一拼接其他接口 |
| service-worker.js | 所有 API 路径都不缓存 + 版本号升级 | 避免缓存导致改动不生效 |
