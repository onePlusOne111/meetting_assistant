// 验证大模型流式输出与降级：
//   node scripts/test-llm.js              正常调用（优先 Claude）
//   node scripts/test-llm.js --break      故意把 Claude key 改错，验证降级到 GLM
// 注意：Node 的 fetch 默认不走系统代理，需要代理时加 NODE_USE_ENV_PROXY=1
const { loadConfig } = require('../src/main/config');
const { streamAnswer } = require('../src/main/llm');
const { Conversation } = require('../src/main/conversation');

(async () => {
  const cfg = loadConfig();
  if (process.argv.includes('--break')) cfg.claude.apiKey = 'sk-ant-invalid';
  const conv = new Conversation(cfg.assistant);
  conv.addTurn('你好，我是甲方的产品负责人王磊。', '王总您好，我是负责这个项目的工程师，今天主要同步一下进度。');
  const messages = conv.buildMessages('我们这个项目下周三之前能完成第一版吗？另外预算方面你们有什么考虑？');
  const t0 = Date.now();
  let first = 0;
  const result = await streamAnswer({
    config: cfg,
    system: conv.systemPrompt,
    messages,
    maxTokens: cfg.assistant.maxTokens,
    onEvent: (e) => {
      if (e.type === 'provider') console.log(`\n--- 使用 ${e.name} (${e.model}) ---`);
      else if (e.type === 'fallback') console.log(`\n[降级] ${e.from} 失败: ${e.error}`);
      else if (e.type === 'delta') {
        if (!first) first = Date.now() - t0;
        process.stdout.write(e.text);
      }
    },
  });
  console.log(`\n\n完成：provider=${result.provider} 首字=${first}ms 总耗时=${Date.now() - t0}ms`);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
