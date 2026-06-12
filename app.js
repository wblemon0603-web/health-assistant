/* ==========================================================================
   健康助手 - 前端主逻辑
   功能：
     1. 发送文本消息 -> 调用 AI 接口 -> 显示回复
     2. 上传/拍照图片 -> 转 base64 (data URL) -> 一起发送
     3. localStorage 持久化消息
     4. "AI 正在输入..." 打字动画
     5. Markdown 渲染（marked + DOMPurify 防 XSS）
   ========================================================================== */

(function () {
  'use strict';

  // ----- 常量配置 -----
  var STORAGE_KEY = 'health_assistant_messages_v1'; // localStorage 键名
  var DEFAULT_API_URL = 'http://localhost:3000/chat'; // 默认后端地址（也可在 env.js 中覆盖）

  // 从全局环境配置中读取 API 地址（见 env.js）
  var API_URL = (window.__HELPER_CONFIG__ && window.__HELPER_CONFIG__.API_URL) || DEFAULT_API_URL;

  // ----- DOM 引用 -----
  var chatEl = document.getElementById('chat');
  var formEl = document.getElementById('chatForm');
  var inputEl = document.getElementById('messageInput');
  var sendBtnEl = formEl.querySelector('.chat-input-bar__send');

  var imageInputEl = document.getElementById('imageInput');
  var imageBtnEl = document.getElementById('imageBtn');
  var imagePreviewEl = document.getElementById('imagePreview');
  var imagePreviewImgEl = document.getElementById('imagePreviewImg');
  var imageRemoveEl = document.getElementById('imageRemove');

  var clearBtnEl = document.getElementById('clearBtn');

  // ----- 运行时状态 -----
  var pendingImageDataUrl = null;   // 待发送图片（base64 data URL）
  var isWaiting = false;            // 是否在等待 AI 回复（防止重复发送）
  var typingEl = null;              // 当前打字动画节点

  // ==========================================================================
  // 1. 消息模型与持久化
  // ==========================================================================

  /**
   * 从 localStorage 读取消息数组
   * 消息对象结构: { role: 'user'|'ai', text: string, image: string|null, ts: number }
   */
  function loadMessages() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('读取消息失败:', e);
      return [];
    }
  }

  /** 保存消息到 localStorage */
  function saveMessages(messages) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
      console.warn('保存消息失败（可能超过存储配额）:', e);
    }
  }

  // 当前消息列表（内存）
  var messages = loadMessages();

  // ==========================================================================
  // 2. 渲染消息到 DOM
  // ==========================================================================

  /** 把 Markdown 文本安全地渲染为 HTML */
  function renderMarkdown(text) {
    var html = '';
    if (window.marked) {
      try {
        // marked 4.x+ 支持 parse 方法；老版本用 marked()
        html = typeof window.marked.parse === 'function'
          ? window.marked.parse(text)
          : window.marked(text);
      } catch (e) {
        html = escapeHtml(text);
      }
    } else {
      html = escapeHtml(text);
    }
    // 使用 DOMPurify 防止 XSS（AI 返回内容不可信）
    if (window.DOMPurify) {
      html = window.DOMPurify.sanitize(html);
    }
    return html;
  }

  /** 简易 HTML 转义（当 marked 未加载时使用） */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 创建一条消息 DOM 节点 */
  function createMessageEl(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'msg msg--' + msg.role;

    var bubble = document.createElement('div');
    bubble.className = 'msg__bubble';

    // 若有图片，先渲染图片
    if (msg.image) {
      var img = document.createElement('img');
      img.className = 'msg-image';
      img.alt = '图片';
      img.src = msg.image;
      bubble.appendChild(img);
    }

    // 文本内容
    if (msg.text) {
      var content = document.createElement('div');
      content.className = 'msg__content';
      if (msg.role === 'ai') {
        content.innerHTML = renderMarkdown(msg.text);
      } else {
        // 用户消息直接转义展示（避免误解析）
        content.innerHTML = escapeHtml(msg.text).replace(/\n/g, '<br/>');
      }
      bubble.appendChild(content);
    }

    wrap.appendChild(bubble);
    return wrap;
  }

  /** 创建/更新打字动画节点 */
  function showTyping() {
    if (typingEl) return typingEl;
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
    chatEl.appendChild(wrap);
    typingEl = wrap;
    scrollToBottom();
    return typingEl;
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) {
      typingEl.parentNode.removeChild(typingEl);
    }
    typingEl = null;
  }

  /** 滚动到消息区底部 */
  function scrollToBottom() {
    // 使用 requestAnimationFrame 让滚动在布局完成后执行
    window.requestAnimationFrame(function () {
      chatEl.scrollTop = chatEl.scrollHeight;
    });
  }

  /** 渲染当前 messages 中的全部消息 */
  function renderAll() {
    chatEl.innerHTML = '';
    if (messages.length === 0) {
      // 首次打开给出一条欢迎提示（作为 AI 消息）
      var welcome = {
        role: 'ai',
        text: '你好，我是你的健康助手 👋\n\n可以问我关于饮食、运动、作息、症状等方面的问题，也可以**上传一张图片**（如化验单、食物照片）让我帮你分析。',
        ts: Date.now()
      };
      messages.push(welcome);
      saveMessages(messages);
    }
    messages.forEach(function (m) {
      chatEl.appendChild(createMessageEl(m));
    });
    scrollToBottom();
  }

  // ==========================================================================
  // 3. 发送消息与 API 调用
  // ==========================================================================

  /** 把 File 对象转为 base64 data URL */
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  /** 调用后端 POST /chat 接口 */
  function callApi(payload) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      return res.json();
    });
  }

  /** 发送一条用户消息（文本 + 可选图片） */
  function sendMessage(text, imageDataUrl) {
    if (isWaiting) return;
    if (!text && !imageDataUrl) return;

    isWaiting = true;
    setInputDisabled(true);

    // 添加用户消息
    var userMsg = {
      role: 'user',
      text: text || '',
      image: imageDataUrl || null,
      ts: Date.now()
    };
    messages.push(userMsg);
    saveMessages(messages);
    chatEl.appendChild(createMessageEl(userMsg));
    scrollToBottom();

    // 显示"AI 正在输入..."
    showTyping();

    // 组装请求体：图片以 data URL 形式发送（后端自行解析 base64）
    // 如果后端要求图床 URL，可在 callApi 前先上传图床，再把 URL 放入 image_url
    var payload = { message: text || '' };
    if (imageDataUrl) {
      payload.image_url = imageDataUrl;
    }

    // 调用接口
    callApi(payload)
      .then(function (data) {
        var replyText = (data && (data.reply || data.message || data.content)) || '（无回复内容）';
        var aiMsg = {
          role: 'ai',
          text: replyText,
          image: null,
          ts: Date.now()
        };
        hideTyping();
        messages.push(aiMsg);
        saveMessages(messages);
        chatEl.appendChild(createMessageEl(aiMsg));
        scrollToBottom();
      })
      .catch(function (err) {
        console.error('调用接口失败:', err);
        hideTyping();
        var errMsg = {
          role: 'ai',
          text: '⚠️ 抱歉，暂时无法连接到服务，请稍后再试。\n\n错误信息：`' + escapeHtml(err.message) + '`',
          ts: Date.now()
        };
        messages.push(errMsg);
        saveMessages(messages);
        chatEl.appendChild(createMessageEl(errMsg));
        scrollToBottom();
      })
      .then(function () {
        isWaiting = false;
        setInputDisabled(false);
        inputEl.focus();
      });
  }

  /** 禁用/启用输入相关控件 */
  function setInputDisabled(disabled) {
    inputEl.disabled = disabled;
    sendBtnEl.disabled = disabled;
    imageBtnEl.disabled = disabled;
  }

  // ==========================================================================
  // 4. 事件绑定
  // ==========================================================================

  // 表单提交：发送消息
  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = inputEl.value.trim();
    var image = pendingImageDataUrl;
    if (!text && !image) return;
    sendMessage(text, image);
    // 清空输入与图片
    inputEl.value = '';
    clearPendingImage();
  });

  // 输入时：控制发送按钮是否可用（纯视觉反馈）
  inputEl.addEventListener('input', function () {
    // 输入过程中不做额外处理；按钮在 isWaiting 时才禁用
  });

  // 点击相机按钮：触发文件选择
  imageBtnEl.addEventListener('click', function () {
    imageInputEl.value = '';           // 允许再次选择同一张图
    imageInputEl.click();
  });

  // 文件选择变化：读取并预览
  imageInputEl.addEventListener('change', function () {
    var file = imageInputEl.files && imageInputEl.files[0];
    if (!file) return;
    // 基本的类型/大小检查
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
      // 将焦点放回输入框，方便继续输入文字
      inputEl.focus();
    }).catch(function (err) {
      console.error('读取图片失败:', err);
      alert('读取图片失败');
    });
  });

  // 移除预览图片
  imageRemoveEl.addEventListener('click', clearPendingImage);

  function clearPendingImage() {
    pendingImageDataUrl = null;
    imagePreviewEl.hidden = true;
    imagePreviewImgEl.removeAttribute('src');
    imageInputEl.value = '';
  }

  // 清空历史记录
  clearBtnEl.addEventListener('click', function () {
    if (!confirm('确定要清空所有聊天记录吗？')) return;
    messages = [];
    saveMessages(messages);
    clearPendingImage();
    renderAll();
  });

  // ==========================================================================
  // 5. 初始化
  // ==========================================================================

  // 初始渲染
  renderAll();

  // 监听可见性变化：回来时滚到底（避免页面长时间离开后位置错乱）
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scrollToBottom();
  });

  // 软键盘弹起时（iOS 上），尝试滚到底
  window.addEventListener('resize', scrollToBottom);

})();
