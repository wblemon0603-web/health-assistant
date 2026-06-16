/* ==========================================================================
   健康助手 - 前端主逻辑（修复版）
   功能：
     1. 发送文本/图片消息 -> 调用 /api/chat -> 显示回复
     2. 启动时从 /api/messages/history 加载历史消息
     3. 每条消息通过 /api/messages/save 同步到云端
     4. 打字动画 + Markdown 渲染
     5. 顶部 🍽 一键查看今日饮食 /food-logs
     6. 长按"清空"按钮 → 诊断 /api/health
   修复点（相对于原版本）：
     - callChatApi 返回 { reply, usedTools, foodLogged, toolErrors } 结构化对象
     - AI 消息气泡下方新增 meta 标签（已记录/失败/使用工具）
     - 错误信息透传完整响应正文，不再只显示 HTTP 500
     - 新增 今日饮食（/food-logs） 和 诊断（/health） 入口
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
    HISTORY_API_URL: 'https://tswpbzbxdx.coze.site/api/messages',
    API_BASE: 'https://tswpbzbxdx.coze.site/api'
  };
  var API_URL = cfg.API_URL;
  var HISTORY_API_URL = cfg.HISTORY_API_URL;
  var API_BASE = cfg.API_BASE;

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

  // 🍽 弹层是否当前打开（用于 AI 改动后是否需要同步重渲染）
  var foodModalOpen = false;

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
      return [];
    }
  }

  function saveMessagesToLocal(msgList) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgList));
    } catch (e) {}
  }

  // ==========================================================================
  // 2. 云端同步（/api/messages/save 和 /api/messages/history）
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

    // ⭐ 新增：AI 消息气泡下方的工具执行小标签
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
  // 4. 发送消息与 API 调用（⭐ 关键改造）
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
   * ⭐ 修复：返回完整结构化对象，让上层能拿到 food_logged / tool_errors / used_tools
   * 同时把后端错误正文透传出来，不再只看到 "HTTP 500"
   */
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
        // 先拿完整文本，再根据 status 判断是否抛错
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

    // 添加并渲染用户消息
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

    // 显示打字动画
    showTyping();

    // 调用后端获取 AI 回复
    callChatApi(text, imageDataUrl)
      .then(function (result) {
        hideTyping();

        // ⭐ 构造 meta 信息显示在 AI 消息气泡下方（优化：删/改也显示 ✓ 状态）
        var meta = null;
        var usedSet = new Set(
          (result.usedTools || []).map(function (t) {
            return String(t).replace('(failed)', '');
          })
        );
        if (result.foodLogged) {
          meta = { kind: 'ok', text: '✓ 已记录到今日饮食' };
        } else if (usedSet.has('delete_food_log')) {
          meta = { kind: 'ok', text: '✓ 已从今日饮食删除' };
        } else if (usedSet.has('update_food_log')) {
          meta = { kind: 'ok', text: '✓ 已更新今日饮食' };
        } else if (result.toolErrors && result.toolErrors.length > 0) {
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

        // ⭐ AI 改动了饮食数据（新增/删除/修改）→ 同步刷新 🍽 弹层缓存
        var mutatedTools = ['log_food', 'delete_food_log', 'update_food_log'];
        var mutated = result.foodLogged || (
          Array.isArray(result.usedTools) &&
          result.usedTools.some(function (t) {
            return mutatedTools.indexOf(String(t).replace('(failed)', '')) !== -1;
          })
        );
        if (mutated) {
          refreshFoodModalIfOpen();
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
  // 5. ⭐ 新增：今日饮食查看（自检入口） + 诊断
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

  // AI 改动了数据时调用：如果 🍽 弹层正打开就重渲染，关闭时下次打开会自然刷新
  function refreshFoodModalIfOpen() {
    if (!foodModalOpen) return;  // 没打开就不浪费请求
    var body = document.getElementById('foodModalBody');
    // 不显示"加载中"避免闪烁，悄悄替换
    fetchTodayFoodLogs()
      .then(renderFoodLogModal)
      .catch(function (err) {
        console.warn('[foodModal] refresh failed:', err);
        // 失败不弹错，保留原内容
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
    foodModalOpen = true;             // 标记打开
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
    foodModalOpen = false;            // 标记关闭
  }

  // ⭐ 诊断：调 /api/health（长按"清空"按钮调出）
  function runDiagnostics() {
    var url = API_BASE + '/health';
    fetch(url).then(function (r) { return r.text(); }).then(function (raw) {
      alert('诊断结果（API: ' + API_BASE + '）\n\n' + raw);
    }).catch(function (err) {
      alert('诊断失败：' + err.message + '\n\nAPI: ' + API_BASE);
    });
  }

  // ==========================================================================
  // 6. 事件绑定
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

    // 发送消息
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = inputEl.value.trim();
      var image = pendingImageDataUrl;
      if (!text && !image) return;
      sendMessage(text, image);
      inputEl.value = '';
      clearPendingImage();
    });

    // 图片选择按钮
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

    // 移除预览图
    imageRemoveEl.addEventListener('click', clearPendingImage);

    function clearPendingImage() {
      pendingImageDataUrl = null;
      imagePreviewEl.hidden = true;
      imagePreviewImgEl.removeAttribute('src');
      imageInputEl.value = '';
    }

    // 清空消息
    clearBtnEl.addEventListener('click', function () {
      if (!confirm('确定要清空所有聊天记录吗？')) return;
      messages = [];
      saveMessagesToLocal(messages);
      // 重置 session_id
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(SESSION_KEY, sessionId);
      clearPendingImage();
      renderAll();
    });

    // ⭐ 今日饮食按钮
    foodLogBtnEl.addEventListener('click', openFoodModal);

    // ⭐ 长按"清空"调出诊断
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

    // 弹层关闭（点击背景或 ×）
    foodModalEl.addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.close) closeFoodModal();
    });
  }

  // ==========================================================================
  // 7. 初始化
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

    // 后台异步从云端拉取最新历史
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

  // 软键盘弹起时滚动到底
  window.addEventListener('resize', function () { scrollToBottom(); });
})();
