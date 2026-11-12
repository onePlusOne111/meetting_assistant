// 用测试音频验证讯飞实时转写：node scripts/test-asr.js [wav路径]
const path = require('path');
const { loadConfig, ROOT } = require('../src/main/config');
const { RtasrSession } = require('../src/main/rtasr');
const { readPcmFromWav, streamPcm } = require('../src/main/wav');

const file = process.argv[2] || path.join(ROOT, 'test-audio', 'sample.wav');
const cfg = loadConfig();
const pcm = readPcmFromWav(file);
console.log(`音频 ${(pcm.length / 32000).toFixed(1)}s`);

const session = new RtasrSession(cfg.xfyun);
const finals = [];
session.on('started', (sid) => {
  console.log('started', sid);
  streamPcm(pcm, (c) => session.sendAudio(c), () => session.end());
});
session.on('result', (r) => {
  if (r.final) finals.push(r.text);
  console.log(r.final ? '[最终]' : '[中间]', r.text);
});
session.on('error', (e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
session.on('close', () => {
  console.log('\n完整结果:', finals.join(''));
  process.exit(finals.join('') ? process.exitCode || 0 : 1);
});
session.connect();
