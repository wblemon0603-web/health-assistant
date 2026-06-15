// ============================================================
// 环境配置文件：根据访问环境自动切换后端 URL
// ============================================================
// - 生产环境（正式域名访问）：自动使用 PROD 配置
// - 开发环境（localhost / IP 访问）：自动使用 DEV 配置
// - 支持 URL 参数手动切换：?env=dev  或  ?env=prod
// - 在页面底部会显示当前使用的环境标识
// ============================================================

// 两套环境配置
var ENV_CONFIG = {
  prod: {
    label: '生产环境',
    color: '#00a870',
    apiUrl: 'https://tswpbzbxdx.coze.site/api/chat',
    historyApiUrl: 'https://tswpbzbxdx.coze.site/api/messages'
  },
  dev: {
    label: '开发环境',
    color: '#f5a623',
    apiUrl: 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api/chat',
    historyApiUrl: 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site/api/messages'
  }
};

// 判断访问来源：localhost / 127.0.0.1 / IP 地址 => 开发环境；否则 => 生产环境
var host = window.location.hostname;
var isLocalDev = host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host);

// 支持 URL 参数手动强制切换（优先级最高）
var urlParamMatch = window.location.search.match(/[?&]env=(dev|prod)/i);
var envKey = urlParamMatch
  ? urlParamMatch[1].toLowerCase()
  : (isLocalDev ? 'dev' : 'prod');

// 生效配置
window.__HELPER_CONFIG__ = {
  env: envKey,
  label: ENV_CONFIG[envKey].label,
  color: ENV_CONFIG[envKey].color,
  API_URL: ENV_CONFIG[envKey].apiUrl,
  HISTORY_API_URL: ENV_CONFIG[envKey].historyApiUrl
};
