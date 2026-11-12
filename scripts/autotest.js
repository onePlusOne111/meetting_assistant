// 端到端自测：MA_AUTOTEST=1 MA_TEST_AUDIO=test-audio/sample.wav npx electron . [--demo]
// 通过界面按钮驱动「测试音频 → 讯飞转写 → 解答」全链路，截图保存到 test-audio/
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'test-audio');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function autotest({ app, win, asr, answer, hideWindow, showWindow, conversation, MODE }) {
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log('[autotest] screenshot', name);
  };
  const js = (code) => win.webContents.executeJavaScript(code);
  const fail = (msg) => {
    console.error('[autotest] FAIL', msg);
    app.exit(1);
  };

  try {
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    await sleep(500);
    const btn = MODE === 'demo' ? 'toggle' : 'listen';
    // MA_AUTOTEST_SOURCE=system：用扬声器播放测试音频，验证系统音频回环采集
    const source = process.env.MA_AUTOTEST_SOURCE || 'file';
    await js(`document.getElementById('source').value='${source}'; document.getElementById('${btn}').click();`);

    let transcript = '';
    asr.on('transcript', (t) => (transcript = t.finals.join('') + t.pending));
    if (source === 'system') {
      await sleep(1500);
      console.log('[autotest] asr state:', asr.state, await js(`document.getElementById('status').textContent`));
      require('child_process').spawn('afplay', [asr.testAudioFile]);
    }
    await sleep(5000);
    await shot(`${MODE}-1-transcribing.png`);
    await sleep(5000);
    console.log('[autotest] transcript:', transcript);
    if (!transcript) return fail('没有转写结果');

    if (MODE === 'demo') {
      const shown = await js(`document.getElementById('transcript').innerText`);
      console.log('[autotest] page shows:', shown);
      if (shown.replace(/\s/g, '') !== transcript.replace(/\s/g, '')) return fail('页面显示与转写结果不一致');
      await shot('demo-2-done.png');
      console.log('[autotest] PASS');
      return app.exit(0);
    }

    await js(`document.getElementById('answer').click();`);
    for (let i = 0; i < 60 && conversation.turns.length === 0; i++) await sleep(500);
    if (!conversation.turns.length || !conversation.turns[0].reply) return fail('没有得到回复');
    console.log('[autotest] reply:', conversation.turns[0].reply);
    await shot('assistant-2-answered.png');

    hideWindow();
    await sleep(300);
    const hidden = !win.isVisible();
    showWindow();
    await sleep(300);
    console.log('[autotest] hide->', hidden, ' show->', win.isVisible());
    if (!hidden || !win.isVisible()) return fail('隐藏/显示异常');

    console.log('[autotest] listening after answer:', asr.state);
    console.log('[autotest] PASS');
    app.exit(0);
  } catch (err) {
    fail(err.stack || err);
  }
};
