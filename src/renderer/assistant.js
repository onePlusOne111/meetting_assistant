const $ = (id) => document.getElementById(id);
const capture = new AudioCapture();
const STATUS_TEXT = { connecting: '连接中…', listening: '', stopped: '', error: '出错' };
let listening = false;
let answerRaw = '';

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

// 只处理加粗，足够显示要点
function renderMarkdown(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function setListening(on) {
  listening = on;
  $('listen').textContent = on ? '停止监听' : '开始监听';
  $('listen').classList.toggle('active', on);
  $('source').disabled = on;
  if (!on) $('level').style.width = '0';
}

function setAnswerHtml(html) {
  $('answerText').innerHTML = html;
  $('answerText').scrollTop = 1e9;
}

async function startListening() {
  const source = $('source').value;
  $('listen').disabled = true;
  try {
    const r = await window.api.asrStart(source);
    if (!r.ok) throw new Error(r.message);
    setListening(true);
    await capture.start(source, (lv) => ($('level').style.width = `${Math.min(100, lv * 400)}%`));
  } catch (err) {
    capture.stop();
    await window.api.asrStop();
    $('status').textContent = `启动失败：${err.message}`;
  } finally {
    $('listen').disabled = false;
  }
}

$('listen').onclick = async () => {
  if (listening) {
    capture.stop();
    await window.api.asrStop();
  } else {
    startListening();
  }
};
$('answer').onclick = () => window.api.answer();
$('clear').onclick = () => window.api.clear();
$('hide').onclick = () => window.api.hide();
$('quit').onclick = () => window.api.quit();

window.api.on('asr:status', ({ state, message }) => {
  $('dot').className = `dot ${state}`;
  $('status').textContent = (STATUS_TEXT[state] || '') + (message ? ` ${message}` : '');
  if (state === 'stopped' || state === 'error') {
    capture.stop();
    setListening(false);
  }
});

window.api.on('asr:transcript', ({ finals, pending }) => {
  const el = $('transcript');
  if (!finals.length && !pending) {
    el.innerHTML = `<span class="placeholder">${listening ? '等待对方发言…' : '开始监听后，对方的话会实时显示在这里'}</span>`;
    return;
  }
  el.innerHTML = escapeHtml(finals.join('')) + (pending ? `<span class="pending">${escapeHtml(pending)}</span>` : '');
  el.scrollTop = 1e9;
});

window.api.on('answer:start', ({ turn }) => {
  answerRaw = '';
  $('provider').textContent = '';
  $('turn').textContent = `第 ${turn} 轮`;
  setAnswerHtml('<span class="placeholder">思考中…</span>');
});

window.api.on('answer:event', (e) => {
  if (e.type === 'provider') {
    $('provider').textContent = e.model;
  } else if (e.type === 'fallback') {
    answerRaw = '';
    setAnswerHtml(`<span class="notice">${escapeHtml(e.from)} 调用失败，切换下一个模型…</span>`);
  } else if (e.type === 'delta') {
    answerRaw += e.text;
    setAnswerHtml(renderMarkdown(answerRaw));
  }
});

window.api.on('answer:error', ({ message }) => {
  const prefix = answerRaw ? `${renderMarkdown(answerRaw)}\n\n` : '';
  setAnswerHtml(`${prefix}<span class="error">${escapeHtml(message)}</span>`);
});

window.api.on('answer:cleared', () => {
  answerRaw = '';
  $('provider').textContent = '';
  $('turn').textContent = '';
  setAnswerHtml('<span class="placeholder">已清空对话历史</span>');
});

window.api.info().then(({ hasTestAudio, state }) => {
  if (hasTestAudio) $('source').insertAdjacentHTML('beforeend', '<option value="file">测试音频文件</option>');
  $('dot').className = `dot ${state}`;
});
