# 健康助手 · 前端完整代码

> 移动端健康助手聊天 Web App - iMessage 风格 UI + PWA 支持

---

## 📁 文件结构

```
health-assistant-frontend/
├── index.html              # 页面结构（HTML）
├── style.css               # 样式（iMessage 风格 + 响应式）
├── app.js                  # 核心逻辑（消息发送、持久化、Markdown）
├── env.js                  # 环境配置（开发/生产两套 API 地址）
├── manifest.json           # PWA 清单文件
├── service-worker.js       # Service Worker（离线缓存）
└── icons/
    ├── icon-192.png        # 应用图标（192×192）
    └── icon-512.png        # 应用图标（512×512）
```

---

## 🔌 后端接口约定（必须实现）

| 接口 | 方法 | 请求体 / 参数 | 响应体 |
|------|------|---------------|--------|
| `/api/chat` | POST | `{ message, session_id, image_url? }` | `{ reply, ... }` |
| `/api/messages/save` | POST | `{ role, content, session_id, image_url? }` | `{ success, message_id }` |
| `/api/messages/history` | GET | `?session_id=xxx&limit=100` | `{ messages: [...] }` |

**注意**：上传图片时，前端将图片以 `base64 data URL`（形如 `data:image/jpeg;base64,xxxx`）作为 `image_url` 字段发送。

---

## 🌐 两套环境的 API 基础地址

```
开发环境：https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api
生产环境：https://tswpbzbxdx.coze.site/api
```

**环境判断规则**：
- URL 带 `?env=xxx` → 优先使用指定环境
- 通过 `localhost` / `127.0.0.1` / IP 地址访问 → 默认 `dev`
- 通过正式域名访问 → 默认 `prod`

---

## 📄 1. index.html

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

  <!-- PWA manifest -->
  <link rel="manifest" href="./manifest.json" />
  <link rel="apple-touch-icon" href="./icons/icon-192.png" />

  <!-- 样式 -->
  <link rel="stylesheet" href="./style.css" />

  <!-- Markdown 渲染：marked + 安全清理 DOMPurify（通过 CDN） -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js" defer></script>
</head>
<body>
  <!-- 顶部导航栏 -->
  <header class="app-header">
    <div class="app-header__inner">
      <h1 class="app-header__title">健康助手</h1>
      <span id="envBadge" class="env-badge" title="当前后端环境">生产</span>
      <button id="clearBtn" class="app-header__action" type="button" title="清空消息">清空</button>
    </div>
  </header>

  <!-- 消息列表区域 -->
  <main id="chat" class="chat-list" aria-live="polite"></main>

  <!-- 底部输入区域 -->
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

  <!-- 环境配置（API 地址） -->
  <script src="./env.js"></script>
  <!-- 主逻辑 -->
  <script src="./app.js" defer></script>

  <!-- 注册 Service Worker -->
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

## 📄 2. style.css

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
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue",
    "Microsoft YaHei", "Segoe UI", Roboto, Arial, sans-serif;
  font-size: var(--font-size-base);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
}

button {
  font-family: inherit;
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
}

input { font-family: inherit; }

body {
  display: flex;
  flex-direction: column;
}

/* ==== 顶部导航栏 ==== */
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-header-bg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid var(--color-header-border);
  padding-top: var(--safe-top);
}

.app-header__inner {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 0 12px;
}

.app-header__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.app-header__action {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  color: var(--color-user-bubble);
  padding: 6px 8px;
  border-radius: 8px;
}

.app-header__action:active {
  background: rgba(0, 122, 255, 0.12);
}

/* ==== 消息列表区 ==== */
.chat-list {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.msg { display: flex; max-width: 100%; }
.msg--user { justify-content: flex-end; }
.msg--ai { justify-content: flex-start; }

.msg__bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: var(--radius-bubble);
  word-wrap: break-word;
  word-break: break-word;
  box-shadow: var(--shadow-soft);
  position: relative;
  animation: bubble-in 0.2s ease-out;
  font-size: 15px;
  line-height: 1.45;
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

@keyframes bubble-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.msg__bubble img.msg-image {
  display: block;
  max-width: 100%;
  border-radius: 12px;
  margin: 6px 0;
}

/* ==== Markdown 渲染 ==== */
.msg__content p { margin: 0; }
.msg__content p + p { margin-top: 6px; }
.msg--ai .msg__content a { color: var(--color-user-bubble); }
.msg--user .msg__content a { color: #fff; text-decoration: underline; }

.msg__content table {
  border-collapse: collapse;
  margin: 6px 0;
  width: 100%;
  font-size: 13px;
}

.msg__content th,
.msg__content td {
  border: 1px solid rgba(127, 127, 127, 0.3);
  padding: 4px 8px;
  text-align: left;
}

.msg__content th { background: rgba(127, 127, 127, 0.15); font-weight: 600; }

.msg__content code {
  background: rgba(127, 127, 127, 0.2);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}

.msg__content pre {
  background: rgba(0, 0, 0, 0.05);
  padding: 8px 10px;
  border-radius: 8px;
  overflow-x: auto;
}

.msg__content pre code { background: transparent; padding: 0; }

.msg__content ul,
.msg__content ol {
  margin: 4px 0 4px 20px;
  padding: 0;
}

/* ==== 打字动画 ==== */
.typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-muted);
  font-size: 14px;
}

.typing__dots { display: inline-flex; gap: 3px; }

.typing__dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-muted);
  opacity: 0.5;
  animation: typing-bounce 1.2s infinite;
}

.typing__dots span:nth-child(2) { animation-delay: 0.15s; }
.typing__dots span:nth-child(3) { animation-delay: 0.3s; }

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* ==== 底部输入栏 ==== */
.chat-input-bar {
  background: var(--color-header-bg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 1px solid var(--color-header-border);
  padding: 8px 10px calc(8px + var(--safe-bottom));
  position: sticky;
  bottom: 0;
  z-index: 10;
}

.chat-input-bar__file { display: none; }

.chat-input-bar__icon {
  padding: 8px;
  color: var(--color-user-bubble);
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chat-input-bar__icon:active {
  background: rgba(0, 122, 255, 0.12);
}

.chat-input-bar__form {
  display: flex;
  align-items: center;
  gap: 8px;
}

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
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-send-bg);
  color: var(--color-send-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s ease, background 0.2s ease;
  flex: 0 0 auto;
}

.chat-input-bar__send:disabled {
  background: var(--color-send-bg-disabled);
  cursor: not-allowed;
}

.chat-input-bar__send:not(:disabled):active {
  transform: scale(0.92);
}

/* ==== 图片预览 ==== */
.image-preview {
  position: relative;
  margin-top: 6px;
  padding-left: 4px;
}

.image-preview img {
  max-height: 90px;
  border-radius: 12px;
  display: block;
}

.image-preview__remove {
  position: absolute;
  top: -6px;
  left: 72px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 16px;
  line-height: 22px;
  padding: 0;
}

/* ==== 桌面端响应式 ==== */
@media (min-width: 640px) {
  body { background: #e5e5ea; align-items: center; }
  .app-header, .chat-list, .chat-input-bar { width: 100%; max-width: 480px; }
  .app-header, .chat-input-bar {
    border-left: 1px solid var(--color-header-border);
    border-right: 1px solid var(--color-header-border);
  }
  .chat-list { background: var(--color-bg); }
}

/* ==== 环境标识 ==== */
.env-badge {
  display: inline-block;
  padding: 3px 10px;
  margin: 0 8px;
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  background-color: #00a870;
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
  letter-spacing: 0.5px;
  opacity: 0.9;
  transition: opacity 0.2s ease;
}

.env-badge:hover { opacity: 1; }

.env-badge::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  background: #fff;
  border-radius: 50%;
  vertical-align: middle;
}
```

---

## 📄 3. app.js

```javascript
/* ==========================================================================
   健康助手 - 前端主逻辑
   功能：
     1. 发送文本/图片消息 -> 调用 /api/chat -> 显示回复
     2. 启动时从 /api/messages/history 加载历史消息
     3. 每条消息通过 /api/messages/save 同步到云端
     4. 打字动画 + Markdown 渲染
   后端接口约定：
     POST /api/chat  { message, image_url, session_id } -> { reply, ... }
     POST /api/messages/save { role, content, session_id, image_url } -> { success, message_id }
     GET  /api/messages/history?session_id=xxx&limit=50 -> { messages: [...] }
   ========================================================================== */

(function () {
  'use strict';

  // ----- 常量配置 -----
  var STORAGE_KEY = 'health_assistant_messages_v1';
  var SESSION_KEY = 'health_assistant_session_id';

  // 从 env.js 读取配置
  var cfg = window.__HELPER_CONFIG__ || {
    env: 'prod',
    API_URL: 'https://tswpbzbxdx.coze.site/api/chat',
    HISTORY_API_URL: 'https://tswpbzbxdx.coze.site/api/messages'
  };
  var API_URL = cfg.API_URL;
  var HISTORY_API_URL = cfg.HISTORY_API_URL;

  // ----- 运行时状态 -----
  var pendingImageDataUrl = null;
  var isWaiting = false;
  var typingEl = null;

  // session_id：区分不同对话窗口，首次访问生成一个随机 ID
  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  // 当前内存中的消息列表
  var messages = [];

  // ==========================================================================
  // 1. 消息持久化（localStorage 作为离线缓存）
  // ==========================================================================

  function loadMessagesFromLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[本地] 读取消息失败:', e);
      return [];
    }
  }

  function saveMessagesToLocal(msgList) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgList));
    } catch (e) {
      console.warn('[本地] 保存消息失败:', e);
    }
  }

  // ==========================================================================
  // 2. 云端同步
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
        console.warn('[云端] 加载历史消息失败:', err.message);
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
        console.warn('[云端] 保存消息失败:', err.message);
        return msg;
      });
  }

  // ==========================================================================
  // 3. 渲染消息到 DOM
  // ==========================================================================

  function renderMarkdown(text) {
    var html = '';
    if (window.marked) {
      try {
        html = typeof window.marked.parse === 'function'
          ? window.marked.parse(text)
          : window.marked(text);
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
    window.requestAnimationFrame(function () {
      chatEl.scrollTop = chatEl.scrollHeight;
    });
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
  // 4. 发送消息与 API 调用
  // ==========================================================================

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  function callChatApi(text, imageDataUrl) {
    var payload = {
      message: text || '',
      session_id: sessionId
    };
    if (imageDataUrl) payload.image_url = imageDataUrl;

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        return (data && (data.reply || data.message || data.content)) || '（无回复内容）';
      });
  }

  function sendMessage(text, imageDataUrl) {
    if (isWaiting) return;
    if (!text && !imageDataUrl) return;

    isWaiting = true;
    setInputDisabled(true);

    // 1) 添加并渲染用户消息
    var userMsg = {
      role: 'user',
      text: text || '',
      image: imageDataUrl || null,
      ts: Date.now()
    };
    messages.push(userMsg);
    saveMessagesToLocal(messages);
    renderNewMessage(userMsg);
    saveMessageToCloud(userMsg);

    // 2) 显示打字动画
    showTyping();

    // 3) 调用后端获取 AI 回复
    callChatApi(text, imageDataUrl)
      .then(function (replyText) {
        var aiMsg = { role: 'ai', text: replyText, image: null, ts: Date.now() };
        hideTyping();
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
          text: '⚠️ 抱歉，暂时无法连接到服务，请稍后再试。\n\n错误：' + err.message,
          ts: Date.now()
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
  // 5. 事件绑定
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
      if (!/^image\//.test(file.type)) {
        alert('请选择图片文件');
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        alert('图片过大（>8MB），请选择更小的图片');
        return;
      }
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
  }

  // ==========================================================================
  // 6. 初始化
  // ==========================================================================

  function init() {
    bindEvents();

    // 显示当前环境标识
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

    // 先用本地缓存渲染（保证秒开）
    messages = loadMessagesFromLocal();
    if (messages.length === 0) {
      var welcome = {
        role: 'ai',
        text: '你好，我是你的健康助手 👋\n\n可以问我关于饮食、运动、作息、症状等方面的问题，也可以**上传一张图片**（如化验单、食物照片）让我帮你分析。',
        ts: Date.now()
      };
      messages.push(welcome);
      saveMessagesToLocal(messages);
      saveMessageToCloud(welcome);
    }
    renderAll();

    // 后台异步从云端拉取最新历史
    loadMessagesFromCloud().then(function (cloudMsgs) {
      if (cloudMsgs && cloudMsgs.length > 0) {
        messages = cloudMsgs;
        saveMessagesToLocal(messages);
        renderAll();
      }
    });

    console.log('[健康助手] 就绪。session_id:', sessionId);
  }

  init();

  // 软键盘弹起时滚动到底
  window.addEventListener('resize', function () { scrollToBottom(); });
})();
```

---

## 📄 4. env.js

```javascript
// ============================================================
// 环境配置文件：开发环境 / 生产环境
// ============================================================
// 两套环境的 API 基础地址：
//   开发环境：https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api
//   生产环境：https://tswpbzbxdx.coze.site/api
//
// 具体接口地址由基础地址推导：
//   POST {API_BASE}/chat           → 智能对话
//   POST {API_BASE}/messages/save  → 保存消息
//   GET  {API_BASE}/messages/history?session_id=xxx  → 查询历史
//
// 支持 URL 参数手动切换：?env=prod  或  ?env=dev
//   例：http://10.95.19.184:5173/?env=prod   → 强制用生产环境
//   例：http://10.95.19.184:5173/?env=dev    → 强制用开发环境
//   例：http://你的正式域名.com              → 默认用生产环境
// ============================================================

var DEV_API_BASE = 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api';
var PROD_API_BASE = 'https://tswpbzbxdx.coze.site/api';

// 两套环境配置
var ENV_CONFIG = {
  prod: {
    label: '生产环境',
    color: '#00a870',
    apiUrl: PROD_API_BASE + '/chat',
    historyApiUrl: PROD_API_BASE + '/messages'
  },
  dev: {
    label: '开发环境',
    color: '#f5a623',
    apiUrl: DEV_API_BASE + '/chat',
    historyApiUrl: DEV_API_BASE + '/messages'
  }
};

// 判断当前环境：
//   - URL 带 ?env=xxx：优先使用指定环境
//   - 通过正式域名访问（不是 IP 也不是 localhost）：默认 prod
//   - 通过 IP 或 localhost 访问：默认 dev（方便调试）
var host = window.location.hostname;
var isLocalAccess = host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host);

var urlParamMatch = window.location.search.match(/[?&]env=(dev|prod)/i);
var envKey = urlParamMatch
  ? urlParamMatch[1].toLowerCase()
  : (isLocalAccess ? 'dev' : 'prod');

// 生效配置
window.__HELPER_CONFIG__ = {
  env: envKey,
  label: ENV_CONFIG[envKey].label,
  color: ENV_CONFIG[envKey].color,
  API_URL: ENV_CONFIG[envKey].apiUrl,
  HISTORY_API_URL: ENV_CONFIG[envKey].historyApiUrl
};
```

---

## 📄 5. manifest.json

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

## 📄 6. service-worker.js

```javascript
/* ==========================================================================
   Service Worker - 支持离线打开
   策略：
     - 安装时预缓存核心静态资源 (app shell)
     - 运行时对同源静态资源：缓存优先，回退到网络
     - 跨源资源（CDN marked/dompurify）：stale-while-revalidate
     - 接口请求（/chat, /messages）：不缓存，直接走网络
   ========================================================================== */

var CACHE_NAME = 'health-assistant-v1';
var PRECACHE_URLS = [
  './', './index.html', './style.css', './app.js',
  './env.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];

// ---------- 安装：预缓存 ----------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function (err) {
        console.warn('SW 预缓存部分资源失败：', err);
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

// ---------- 激活：清理旧缓存 ----------
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

// ---------- 请求拦截：按策略处理 ----------
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;  // 只处理 GET 请求

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 接口请求：不走缓存，直接走网络
  if (url.pathname.indexOf('/chat') !== -1 ||
      url.pathname.indexOf('/messages') !== -1) {
    return;
  }

  // 同源资源：缓存优先，缓存没有再走网络
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

  // 跨源资源（如 CDN）：stale-while-revalidate
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

### 1. 本地开发

```bash
# 方案 A：Python（最方便）
python3 -m http.server 5173

# 方案 B：Node.js
npx http-server -p 5173
```

浏览器打开 `http://localhost:5173/`

### 2. 手机测试

确保电脑和手机在同一 Wi-Fi 下，手机浏览器访问：
```
http://电脑局域网IP:5173/
```

**查找电脑 IP（macOS）**：终端输入 `ifconfig | grep inet | grep broadcast`

### 3. 添加到手机主屏幕（PWA）

- **iOS Safari**：打开页面 → 分享按钮 → "添加到主屏幕"
- **Android Chrome**：右上角菜单 → "安装应用"

### 4. 环境切换

页面顶部标题旁边有环境标识徽章（🟢 生产/🟠 开发）。点击可快速切换，或手动在 URL 后加：

- `?env=prod` — 强制使用生产环境 API
- `?env=dev` — 强制使用开发环境 API

---

## 🔧 核心特性

| 特性 | 说明 |
|------|------|
| **智能对话** | 通过 POST `/api/chat` 发送消息，接收 AI 回复 |
| **图片上传** | 支持拍照或选择相册图片（8MB 限制），以 base64 data URL 发送 |
| **消息持久化** | localStorage 本地缓存 + 云端 API 同步 |
| **会话管理** | `session_id` 区分不同对话，存在 localStorage |
| **Markdown 渲染** | AI 回复支持 Markdown（表格、加粗、代码块），通过 marked + DOMPurify 解析 |
| **打字动画** | 等待 AI 回复时显示 "AI 正在输入…" 动画 |
| **PWA 支持** | 可添加到主屏，独立运行，离线可访问 |
| **深色模式** | 自动跟随系统 `prefers-color-scheme` |
| **响应式** | 手机全屏，桌面端限宽 480px（居中显示） |
| **双环境配置** | 开发/生产两套 API，自动识别或手动切换 |

---

## ⚠️ 部署注意事项

1. **HTTPS**：生产环境必须通过 HTTPS 部署（Service Worker 需要）
2. **图标文件**：`icons/icon-192.png` 和 `icons/icon-512.png` 需要真实的 PNG 图片
3. **CORS**：后端接口需要允许前端域名的跨域请求（Access-Control-Allow-Origin）
4. **API 地址**：修改 `env.js` 中的 `DEV_API_BASE` / `PROD_API_BASE` 即可切换后端
