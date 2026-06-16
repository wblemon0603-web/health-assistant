// ============================================================
// 环境配置文件：统一指向可用的扣子后端
// ============================================================
// 重要说明：
//   以下两个域名中，只有 dev 环境的域名是实际可用的：
//   ✅ https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site （可用）
//   ❌ https://tswpbzbxdx.coze.site （不可用，DNS 解析失败/未部署）
//
//   所以当前所有环境都使用 dev 环境的实际可用地址。
//   当 prod 环境的域名部署完成后，再切换到 prod 即可。
//
// 支持 URL 参数手动切换：?env=prod  或  ?env=dev
// ============================================================

// 两套环境配置（当前都指向可用的后端地址）
var ACTUAL_API_BASE = 'https://676170a9-09cc-4651-975b-b7a7d3896547.dev.coze.site';

var ENV_CONFIG = {
  prod: {
    label: '生产环境',
    color: '#00a870',
    apiUrl: ACTUAL_API_BASE + '/api/chat',
    historyApiUrl: ACTUAL_API_BASE + '/api/messages'
  },
  dev: {
    label: '开发环境',
    color: '#f5a623',
    apiUrl: ACTUAL_API_BASE + '/api/chat',
    historyApiUrl: ACTUAL_API_BASE + '/api/messages'
  }
};

// 支持 URL 参数手动切换（默认用 prod）
var urlParamMatch = window.location.search.match(/[?&]env=(dev|prod)/i);
var envKey = urlParamMatch ? urlParamMatch[1].toLowerCase() : 'prod';

// 生效配置
window.__HELPER_CONFIG__ = {
  env: envKey,
  label: ENV_CONFIG[envKey].label,
  color: ENV_CONFIG[envKey].color,
  API_URL: ENV_CONFIG[envKey].apiUrl,
  HISTORY_API_URL: ENV_CONFIG[envKey].historyApiUrl
};
