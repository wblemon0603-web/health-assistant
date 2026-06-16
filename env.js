// ============================================================
// 环境配置文件：开发环境 / 生产环境
// ============================================================
// 两套环境的 API 基础地址：
//   开发环境：https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api
//   生产环境：https://676170a9-09cc-4651-975b-b7a7d3896547.coze.site/api
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
var PROD_API_BASE = 'https://676170a9-09cc-4651-975b-b7a7d3896547.coze.site/api';

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
