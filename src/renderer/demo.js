const $ = (id) => document.getElementById(id);
const capture = new AudioCapture();
const STATUS_TEXT = { connecting: '连接中…', listening: '正在转写', stopped: '已停止', error: '出错' };
let listening = false;

function setListening(on) {
  listening = on;
  $('toggle').textContent = on ? '停止转写' : '开始实时语音转写';
  $('toggle').classList.toggle('stop', on);
  $('source').disabled = on;
  if (!on) $('level').style.width = '0';
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

$('toggle').onclick = async () => {
  if (listening) {
    capture.stop();
    await window.api.asrStop();
    return;
  }
  const source = $('source').value;
  $('toggle').disabled = true;
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
    $('toggle').disabled = false;
  }
};

window.api.on('asr:status', ({ state, message }) => {
  $('status').textContent = STATUS_TEXT[state] + (message ? `：${message}` : '');
  if (state === 'stopped' || state === 'error') {
    capture.stop();
    setListening(false);
  }
});

window.api.on('asr:transcript', ({ finals, pending }) => {
  if (!finals.length && !pending) return;
  $('transcript').innerHTML =
    escapeHtml(finals.join('')) + (pending ? `<span class="pending">${escapeHtml(pending)}</span>` : '');
  document.querySelector('.right').scrollTop = 1e9;
});

window.api.info().then(({ hasTestAudio }) => {
  if (hasTestAudio) $('source').insertAdjacentHTML('beforeend', '<option value="file">测试音频文件</option>');
});
