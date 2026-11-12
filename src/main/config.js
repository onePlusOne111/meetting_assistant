const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = process.env.MA_CONFIG || path.join(ROOT, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`找不到配置文件 ${CONFIG_PATH}，请复制 config.example.json 为 config.json 并填写密钥`);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!cfg.xfyun || !cfg.xfyun.appId || !cfg.xfyun.apiKey) {
    throw new Error('config.json 缺少 xfyun.appId / xfyun.apiKey');
  }
  cfg.assistant = Object.assign(
    { maxTokens: 600, maxHistoryTurns: 20, showOnAnswer: true, contentProtection: true, extraPrompt: '' },
    cfg.assistant || {}
  );
  return cfg;
}

module.exports = { loadConfig, ROOT, CONFIG_PATH };
