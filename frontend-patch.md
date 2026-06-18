# 前端改动指南 — 🍽 弹层在 AI 删/改饮食后自动同步

> 基于现有 frontend-code-fixed.md 的最小改动版。**只动 `app.js` 一个文件**。`index.html` / `style.css` / `env.js` / `service-worker.js` 全部不动。

## 改动总览

| 文件 | 改动 | 说明 |
|---|---|---|
| `app.js` | **3 处微调**：状态变量、AI 回复后联动、提示文案 | AI 调用了 `log_food` / `delete_food_log` / `update_food_log` 后，自动刷新 🍽 弹层数据 |
| 其它所有前端文件 | **完全不动** | 接口契约、DOM、CSS、PWA 缓存策略都没变 |

---

## 原理

🍽 弹层的数据原本是「用户点击时才拉一次」，AI 在后台改了数据，弹层不知道。这次的修改：

1. 增加一个**模块级缓存**变量，记录最近一次拉到的饮食数据
2. AI 回复处理逻辑里，检测到 `used_tools` 包含 `log_food` / `delete_food_log` / `update_food_log` 时，**立即重拉一次** `/food-logs`
3. 如果此时 🍽 弹层正打开（DOM 没 hidden），就**同步重渲染**

这样无论用户是先开弹层再聊天、还是先聊天再开弹层，看到的永远是最新数据。

---

## 1. `app.js` 顶部加一个状态变量

找到现有的模块级变量声明区（一般在文件开头，`var messages = [...]` 附近），追加：

```js
// 🍽 弹层是否当前打开（用于决定 AI 改动后是否需要同步重渲染）
var foodModalOpen = false;
```

---

## 2. 改写 `fetchTodayFoodLogs` + 新增 `refreshFoodModalIfOpen`

把现有的 `fetchTodayFoodLogs` 函数（约第 825 行）整段替换成下面这一组：

```js
// 拉取今日饮食数据
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
```

---

## 3. 改写 `openFoodModal` / `closeFoodModal` — 维护 `foodModalOpen` 状态

把现有这两个函数（约第 884 行）整段替换成：

```js
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
```

---

## 4. AI 回复处理里追加同步刷新逻辑

找到 `sendMessage` 内 `callChatApi(text, imageDataUrl).then(function (result) { ... })` 这段（约第 758–791 行）。在原有的 meta 构造完、`renderNewMessage(aiMsg)` 之前 **追加**：

```js
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
```

完整的 `.then(function (result) {...})` 改完后大致长这样（**仅供对照，不用整段替换**）：

```js
    callChatApi(text, imageDataUrl)
      .then(function (result) {
        hideTyping();

        // 构造 meta 信息
        var meta = null;
        if (result.foodLogged) {
          meta = { kind: 'ok', text: '✓ 已记录到今日饮食' };
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

        // ⭐ 新增：AI 动过数据就同步刷新 🍽
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
```

---

## 5. （可选）让 meta 文案对删/改更友好

现有逻辑里只有 `foodLogged` 才显示 "✓ 已记录到今日饮食"，删除 / 修改会落到 "已使用工具: delete_food_log"。如果想更友好，把 meta 构造那段开头替换为：

```js
        // 构造 meta 信息
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
```

> 这段是可选的，纯文案优化。不替换也不影响主功能。

---

## 6. 不需要改的文件

| 文件 | 为什么不动 |
|---|---|
| `index.html` | 🍽 按钮 / `foodModal` DOM 已就位 |
| `style.css` | `.modal` / `.food-stat` / `.food-log-item` 样式已就位 |
| `env.js` | `API_BASE` 已暴露 |
| `service-worker.js` | `/food-logs` 已经在「绕过缓存走网络」白名单里，每次重拉都是最新数据 |
| 后端任何 route | `/api/chat` 响应字段不变 |

---

## 7. 部署后验收 4 步

1. 发 "中午吃了牛肉 250 卡" → 等 AI 回复（带 ✓ 已记录）
2. 点击 🍽 → 看到午餐牛肉 250 kcal
3. **不关 🍽 弹层**，直接发 "改成 300 卡"
   - 期望：AI 回 "已更新"，🍽 列表里牛肉 **自动从 250 变成 300**，无需关闭重开
4. **继续不关弹层**，发 "删掉午餐那条"
   - 期望：AI 回 "已删除"，🍽 列表里午餐牛肉**自动消失**

如果第 3/4 步 🍽 没自动刷新：
- 打开浏览器 DevTools Console，看是否打印了 `[foodModal] refresh failed`
- 看 Network 面板，发 AI 消息后是否多了一个 `/food-logs` GET 请求
- 如果没有这个请求 → 说明 `result.usedTools` 字段名取错了；把 AI 这条消息的网络响应贴给我

---

## 8. 改动汇总

| 文件 | 改动数 | 总行数变化 |
|---|---|---|
| `app.js` | 顶部加 1 个变量 + 改写 3 个函数 + 追加 8 行联动 + 可选改 meta 文案 | +20~30 行 |

不动 HTML、不动 CSS、不动 env.js、不动 service-worker.js、不动后端任何文件。
