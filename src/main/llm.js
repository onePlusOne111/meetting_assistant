// 大模型流式调用：优先 Claude，失败则降级到 GLM

async function* sseData(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

async function ensureOk(res, name) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${name} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function streamClaude({ cfg, system, messages, maxTokens, signal, fetchImpl, onDelta }) {
  const res = await fetchImpl(`${cfg.baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages, stream: true }),
  });
  await ensureOk(res, 'Claude');
  for await (const data of sseData(res)) {
    let evt;
    try {
      evt = JSON.parse(data);
    } catch (e) {
      continue;
    }
    if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
      onDelta(evt.delta.text);
    } else if (evt.type === 'error') {
      throw new Error(`Claude: ${JSON.stringify(evt.error)}`);
    } else if (evt.type === 'message_stop') {
      return;
    }
  }
}

async function streamGlm({ cfg, system, messages, maxTokens, signal, fetchImpl, onDelta }) {
  const res = await fetchImpl(`${cfg.baseUrl || 'https://open.bigmodel.cn/api/paas/v4'}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      stream: true,
      thinking: { type: 'disabled' },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  await ensureOk(res, 'GLM');
  for await (const data of sseData(res)) {
    if (data === '[DONE]') return;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch (e) {
      continue;
    }
    if (evt.error) throw new Error(`GLM: ${JSON.stringify(evt.error)}`);
    const delta = evt.choices && evt.choices[0] && evt.choices[0].delta;
    if (delta && delta.content) onDelta(delta.content);
  }
}

const PROVIDERS = [
  { name: 'claude', key: 'claude', run: streamClaude },
  { name: 'glm', key: 'glm', run: streamGlm },
];

/**
 * onEvent 事件：
 *  {type:'provider', name}                 开始使用某个模型
 *  {type:'delta', text}                    流式增量
 *  {type:'fallback', from, error}          当前模型失败，已输出的内容作废，换下一个模型
 */
async function streamAnswer({ config, system, messages, maxTokens = 600, signal, fetchImpl = fetch, onEvent }) {
  const providers = PROVIDERS.filter((p) => config[p.key] && config[p.key].apiKey);
  if (!providers.length) throw new Error('config.json 中没有可用的大模型配置');
  let lastErr;
  for (const p of providers) {
    const pcfg = config[p.key];
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) throw new Error('aborted');
      signal.addEventListener('abort', onOuterAbort);
    }
    let gotToken = false;
    const timeoutMs = pcfg.firstTokenTimeoutMs || 15000;
    const timer = setTimeout(() => {
      if (!gotToken) ctrl.abort(new Error(`${p.name} 首字超时 ${timeoutMs}ms`));
    }, timeoutMs);
    onEvent({ type: 'provider', name: p.name, model: pcfg.model });
    try {
      await p.run({
        cfg: pcfg,
        system,
        messages,
        maxTokens,
        signal: ctrl.signal,
        fetchImpl,
        onDelta: (text) => {
          gotToken = true;
          onEvent({ type: 'delta', text });
        },
      });
      return { provider: p.name };
    } catch (err) {
      if (signal && signal.aborted) throw err;
      const reason = ctrl.signal.aborted && ctrl.signal.reason ? ctrl.signal.reason : err;
      lastErr = reason;
      onEvent({ type: 'fallback', from: p.name, error: String(reason && reason.message ? reason.message : reason) });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }
  throw lastErr;
}

module.exports = { streamAnswer };
