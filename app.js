/* ==========================================================================
   健康助手 - 前端主逻辑
   功能：
     1. 发送文本/图片消息 -> 调用 /api/chat -> 显示回复
     2. 启动时从 /api/messages/history 加载历史消息
     3. 每条消息通过 /api/messages/save 同步到云端
     4. 打字动画 + Markdown 渲染
   后端接口约定（扣子提供）：
     POST /api/chat  { message, image_url } -> { reply, session_id, ... }
     POST /api/messages/save { role, content, session_id, image_url } -> { success, message_id }
     GET  /api/messages/history?session_id=xxx&limit=50 -> { messages: [...] }
   数据库字段：role (user/assistant), content, image_url, session_id, timestamp
   ========================================================================== */

(function () {
  'use strict';

  // ----- 常量配置 -----
  var STORAGE_KEY = 'health_assistant_messages_v1';
  var SESSION_KEY = 'health_assistant_session_id';

  // 从 env.js 读取配置
  var API_URL = (window.__HELPER_CONFIG__ && window.__HELPER_CONFIG__.API_URL)
    || 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api/chat';

  var HISTORY_API_URL = (window.__HELPER_CONFIG__ && window.__HELPER_CONFIG__.HISTORY_API_URL)
    || 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api/messages';

  // ----- 运行时状态 -----
  var pendingImageDataUrl = null;
  var isWaiting = false;
  var typingEl = null;

  // session_id：区分不同对话窗口，首次访问时生成一个随机 ID
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
  // 2. 云端同步（/api/messages/save 和 /api/messages/history）
  // ==========================================================================

  /**
   * 从云端加载历史消息（按时间正序返回）
   * 返回本地统一格式的消息数组
   */
  function loadMessagesFromCloud() {
    var url = HISTORY_API_URL + '/history?session_id=' + encodeURIComponent(sessionId) + '&limit=100';
    return fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var cloudMessages = data && Array.isArray(data.messages) ? data.messages : [];
        // 将云端格式转换为本地格式
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
        return null; // 返回 null 表示云端不可用，用本地
      });
  }

  /**
   * 保存单条消息到云端
   * 字段：role (user/assistant), content, session_id, image_url
   */
  function saveMessageToCloud(msg) {
    var payload = {
      role: msg.role === 'ai' ? 'assistant' : 'user', // 后端用 assistant
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
        console.log('[云端] 消息已保存:', data);
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
      } catch (e) {
        html = escapeHtml(text);
      }
    } else {
      html = escapeHtml(text);
    }
    if (window.DOMPurify) {
      html = window.DOMPurify.sanitize(html);
    }
    return html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
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
      '<span class="typing">' +
        'AI 正在输入' +
        '<span class="typing__dots"><span></span><span></span><span></span></span>' +
      '</span>';
    wrap.appendChild(bubble);
    var chatEl = document.getElementById('chat');
    chatEl.appendChild(wrap);
    typingEl = wrap;
    scrollToBottom();
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) {
      typingEl.parentNode.removeChild(typingEl);
    }
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
    messages.forEach(function (m) {
      chatEl.appendChild(createMessageEl(m));
    });
    scrollToBottom();
  }

  function renderNewMessage(msg) {
    var chatEl = document.getElementById('chat');
    chatEl.appendChild(createMessageEl(msg));
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

  /** 调用 POST /api/chat 获取 AI 回复 */
  function callChatApi(text, imageDataUrl) {
    var payload = { message: text || '' };
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
        // 兼容多种可能的字段名
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
    saveMessageToCloud(userMsg); // 异步保存到云端

    // 2) 显示打字动画
    showTyping();

    // 3) 调用后端获取 AI 回复
    callChatApi(text, imageDataUrl)
      .then(function (replyText) {
        var aiMsg = {
          role: 'ai',
          text: replyText,
          image: null,
          ts: Date.now()
        };
        hideTyping();
        messages.push(aiMsg);
        saveMessagesToLocal(messages);
        renderNewMessage(aiMsg);
        saveMessageToCloud(aiMsg); // 异步保存到云端
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
    // 表单提交
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
      // 同时重置 session_id，确保下次加载云端不会读到旧消息
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
    // 绑定事件
    bindEvents();

    // 先用本地缓存渲染（保证秒开）
    messages = loadMessagesFromLocal();
    if (messages.length === 0) {
      // 首次访问，显示欢迎消息
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

    // 后台异步从云端拉取最新历史；如果云端有数据，覆盖本地
    loadMessagesFromCloud().then(function (cloudMsgs) {
      if (cloudMsgs && cloudMsgs.length > 0) {
        messages = cloudMsgs;
        saveMessagesToLocal(messages);
        renderAll();
        console.log('[初始化] 已从云端加载 ' + cloudMsgs.length + ' 条消息');
      }
    });

    console.log('[健康助手] 就绪。session_id:', sessionId);
  }

  init();

  // 软键盘弹起时滚动到底
  window.addEventListener('resize', function () {
    scrollToBottom();
  });

})();
