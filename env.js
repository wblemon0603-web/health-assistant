// ============================================================
// 环境配置：开发 / 生产（修复版）
// 关键点：
//   1. 暴露 API_BASE，方便 app.js 拼 /food-logs、/health
//   2. 默认环境判断更稳健（域名级判断）
// ============================================================

var DEV_API_BASE  = 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api';
var PROD_API_BASE = 'https://tswpbzbxdx.coze.site/api';

// 两套环境配置
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

// 判断当前环境：
//   - URL 带 ?env=xxx：优先使用指定环境
//   - 通过正式域名访问（不是 IP 也不是 localhost）：默认 prod
//   - 通过 IP 或 localhost 访问：默认 dev（方便调试）
var host = window.location.hostname;
var isLocalAccess = host === 'localhost' || host === '127.0.0.1' ||
                    /^\d+\.\d+\.\d+\.\d+$/.test(host);

var urlParamMatch = window.location.search.match(/[?&]env=(dev|prod)/i);
var envKey = urlParamMatch
  ? urlParamMatch[1].toLowerCase()
  : (isLocalAccess ? 'dev' : 'prod');

var picked = ENV_CONFIG[envKey];

// 生效配置（同时暴露 API_BASE）
window.__HELPER_CONFIG__ = {
  env: envKey,
  label: picked.label,
  color: picked.color,
  API_BASE: picked.base,
  API_URL: picked.base + '/chat',
  HISTORY_API_URL: picked.base + '/messages'
};
