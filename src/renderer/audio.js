// 采集音频 → 16k/16bit/单声道 PCM → 主进程 → 讯飞
// source: 'system' 系统音频（会议里对方的声音）| 'mic' 麦克风 | 'file' 测试音频（主进程自己推流）
class AudioCapture {
  constructor() {
    this.stream = null;
    this.ctx = null;
  }

  async start(source, onLevel) {
    if (source === 'file') return;
    if (source === 'system') {
      this.stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      if (!this.stream.getAudioTracks().length) {
        this.stop();
        throw new Error('没有拿到系统音频，请检查「屏幕录制」权限');
      }
      // 只要声音，画面轨道直接停掉
      this.stream.getVideoTracks().forEach((t) => t.stop());
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    }
    this.ctx = new AudioContext({ sampleRate: 16000 });
    await this.ctx.audioWorklet.addModule('pcm-worklet.js');
    const src = this.ctx.createMediaStreamSource(new MediaStream(this.stream.getAudioTracks()));
    const node = new AudioWorkletNode(this.ctx, 'pcm-worklet');
    node.port.onmessage = (e) => {
      window.api.sendAudio(e.data.pcm);
      if (onLevel) onLevel(e.data.level);
    };
    // 接一个静音输出，保证 worklet 持续被调度，同时不会把声音再播出来
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(node).connect(mute).connect(this.ctx.destination);
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
    this.stream = null;
    this.ctx = null;
  }
}

window.AudioCapture = AudioCapture;
