const { EventEmitter } = require('events');
const { RtasrSession } = require('./rtasr');
const { readPcmFromWav, streamPcm } = require('./wav');

/**
 * 管理一次「监听」：讯飞会话 + 当前这一轮对方发言的转写文本。
 * 转写文本 = 已确定的句子(finals) + 正在识别、可能被纠正的句子(pending)。
 *
 * 事件：'status' {state, message}  state: connecting|listening|stopped|error
 *       'transcript' {finals, pending}
 */
class AsrController extends EventEmitter {
  constructor(xfyunConfig, { testAudioFile } = {}) {
    super();
    this.xfyunConfig = xfyunConfig;
    this.testAudioFile = testAudioFile;
    this.session = null;
    this.stopFeed = null;
    this.state = 'stopped';
    this._resetTurn();
  }

  _resetTurn() {
    this.finals = [];
    this.pending = '';
  }

  _setState(state, message = '') {
    this.state = state;
    this.emit('status', { state, message });
  }

  _emitTranscript() {
    this.emit('transcript', { finals: this.finals.slice(), pending: this.pending });
  }

  get listening() {
    return this.state === 'connecting' || this.state === 'listening';
  }

  /** source: 'system' | 'mic' | 'file'。system/mic 的音频由渲染进程通过 pushAudio 送入 */
  start(source) {
    if (this.listening) return Promise.resolve();
    this.skipUntilFinal = false;
    const session = new RtasrSession(this.xfyunConfig);
    this.session = session;
    this._setState('connecting');

    return new Promise((resolve, reject) => {
      session.on('started', () => {
        if (this.session !== session) return;
        this._setState('listening');
        if (source === 'file') this._feedTestFile(session);
        resolve();
      });
      session.on('result', (r) => {
        if (this.session !== session) return;
        this._onResult(r);
      });
      session.on('error', (err) => {
        if (this.session !== session) return;
        this._setState('error', err.message);
        reject(err);
      });
      session.on('close', () => {
        if (this.session !== session) return;
        this._stopFeed();
        this.session = null;
        if (this.state !== 'error') this._setState('stopped');
        reject(new Error('连接已关闭'));
      });
      session.connect();
    });
  }

  _onResult({ text, final }) {
    // cut() 时正在识别的句子已经算进上一轮，它后续的中间结果和最终结果都要丢弃
    if (this.skipUntilFinal) {
      if (final) this.skipUntilFinal = false;
      return;
    }
    if (final) {
      if (text) this.finals.push(text);
      this.pending = '';
    } else {
      this.pending = text;
    }
    this._emitTranscript();
  }

  _feedTestFile(session) {
    if (!this.testAudioFile) return;
    const pcm = readPcmFromWav(this.testAudioFile);
    const silence = Buffer.alloc(1280);
    this.stopFeed = streamPcm(
      pcm,
      (c) => session.sendAudio(c),
      () => {
        // 文件放完后持续发送静音，模拟会议中的持续音频流
        const timer = setInterval(() => session.sendAudio(silence), 40);
        this.stopFeed = () => clearInterval(timer);
      }
    );
  }

  _stopFeed() {
    if (this.stopFeed) this.stopFeed();
    this.stopFeed = null;
  }

  pushAudio(buf) {
    if (this.session) this.session.sendAudio(buf);
  }

  stop() {
    this._stopFeed();
    if (this.session) this.session.end();
  }

  /** 截断当前这一轮，返回对方本轮发言（包含尚未确定的部分），并开始新一轮 */
  cut() {
    const text = (this.finals.join('') + this.pending).replace(/^[，。、！？,.!?\s]+/, '');
    this.skipUntilFinal = !!this.pending && this.listening;
    this._resetTurn();
    this._emitTranscript();
    return text;
  }

  clearTurn() {
    this.skipUntilFinal = !!this.pending && this.listening;
    this._resetTurn();
    this._emitTranscript();
  }
}

module.exports = { AsrController };
