// 讯飞「实时语音转写」(RTASR) WebSocket 客户端
// 音频要求：16kHz、16bit、单声道 PCM，建议每 40ms 发送 1280 字节
const crypto = require('crypto');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const HOST = 'wss://rtasr.xfyun.cn/v1/ws';
const MAX_PENDING_CHUNKS = 100;

function buildUrl({ appId, apiKey, lang }) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const md5 = crypto.createHash('md5').update(appId + ts).digest('hex');
  const signa = crypto.createHmac('sha1', apiKey).update(md5).digest('base64');
  const params = new URLSearchParams({ appid: appId, ts, signa });
  if (lang) params.set('lang', lang);
  return `${HOST}?${params.toString()}`;
}

function parseResult(data) {
  const obj = JSON.parse(data);
  const st = obj.cn && obj.cn.st;
  if (!st) return null;
  let text = '';
  for (const rt of st.rt || []) {
    for (const ws of rt.ws || []) {
      for (const cw of ws.cw || []) text += cw.w || '';
    }
  }
  return { text, final: st.type === '0', segId: obj.seg_id };
}

/**
 * 事件：
 *  - 'started'                       握手成功
 *  - 'result' {text, final, segId}   final=false 为中间结果（会被后续结果纠正/替换）
 *  - 'error'  Error
 *  - 'close'
 */
class RtasrSession extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.ws = null;
    this.started = false;
    this.closed = false;
    this.pending = [];
  }

  connect() {
    this.ws = new WebSocket(buildUrl(this.opts));
    this.ws.on('message', (raw) => this._onMessage(raw.toString()));
    this.ws.on('error', (err) => this._fail(err));
    this.ws.on('close', () => this.close());
  }

  _onMessage(msg) {
    let obj;
    try {
      obj = JSON.parse(msg);
    } catch (e) {
      return;
    }
    if (obj.action === 'started') {
      this.started = true;
      this.emit('started', obj.sid);
      for (const chunk of this.pending) this.ws.send(chunk);
      this.pending = [];
    } else if (obj.action === 'result') {
      try {
        const r = parseResult(obj.data);
        if (r) this.emit('result', r);
      } catch (e) {
        // 忽略无法解析的结果
      }
    } else if (obj.action === 'error') {
      this._fail(new Error(`讯飞转写错误 ${obj.code}: ${obj.desc}`));
    }
  }

  _fail(err) {
    if (this.closed) return;
    this.emit('error', err);
    this.close();
  }

  sendAudio(buf) {
    if (this.closed || !this.ws) return;
    if (!this.started) {
      this.pending.push(buf);
      if (this.pending.length > MAX_PENDING_CHUNKS) this.pending.shift();
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
  }

  /** 通知服务端音频结束，服务端会推送剩余结果后关闭连接 */
  end() {
    if (this.closed || !this.ws) return;
    if (this.ws.readyState === WebSocket.OPEN && this.started) {
      // 服务端按字面量匹配结束标记，必须严格是这个字符串（含空格）
      this.ws.send(Buffer.from('{"end": true}'));
      setTimeout(() => this.close(), 5000);
    } else {
      this.close();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws && this.ws.terminate();
    } catch (e) {
      // ignore
    }
    this.emit('close');
  }
}

module.exports = { RtasrSession };
