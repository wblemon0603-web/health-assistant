// ============================================================
// 环境配置文件：统一指向生产后端
// ============================================================
// 规则（已简化，避免 IP 访问误判为开发环境）：
//   - 默认：所有访问方式都用 生产环境 API
//   - 显式加 ?env=dev：切换到开发环境 API（仅限调试用）
//
// 为什么这样设计？
//   手机通过 10.95.19.184 局域网 IP 访问时，之前会被误判为"开发环境"
//   导致请求发到了测试域名，而测试域名可能没有部署后端服务
//   现在统一用生产环境，确保任何设备都能正常对话
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

// 只有显式 ?env=dev 才用开发环境，其他情况都用生产环境
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
