const fs = require('fs');

/** 读取 16k/16bit/单声道 WAV，返回裸 PCM Buffer */
function readPcmFromWav(file) {
  const buf = fs.readFileSync(file);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') return buf.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${file} 中找不到 data 块`);
}

/** 以实时速率（每 40ms 1280 字节）推送 PCM，返回停止函数 */
function streamPcm(pcm, onChunk, onDone) {
  let pos = 0;
  const timer = setInterval(() => {
    if (pos >= pcm.length) {
      clearInterval(timer);
      onDone && onDone();
      return;
    }
    onChunk(pcm.subarray(pos, pos + 1280));
    pos += 1280;
  }, 40);
  return () => clearInterval(timer);
}

module.exports = { readPcmFromWav, streamPcm };
