const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  session,
  desktopCapturer,
  net,
  dialog,
} = require('electron');
const { loadConfig, ROOT } = require('./config');
const { AsrController } = require('./asr-controller');
const { Conversation } = require('./conversation');
const { streamAnswer } = require('./llm');

// macOS 13+ 通过 ScreenCaptureKit 捕获系统音频（对方的声音）
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare');

const MODE = process.argv.includes('--demo') ? 'demo' : 'assistant';
const RENDERER = path.join(__dirname, '..', 'renderer');
const SHORTCUTS = { answer: 'CommandOrControl+K', hide: 'CommandOrControl+U', show: 'CommandOrControl+G' };

let config;
let win;
let asr;
let conversation;
let answering = null; // {ctrl, other, text}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createAssistantWindow() {
  const W = 760;
  const H = 360;
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 520,
    minHeight: 200,
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: workArea.y + 6,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 共享屏幕时对方看不到这个窗口
  if (config.assistant.contentProtection) win.setContentProtection(true);
  win.loadFile(path.join(RENDERER, 'assistant.html'));
}

function createDemoWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 640,
    title: '实时语音转写 Demo',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
  });
  win.loadFile(path.join(RENDERER, 'demo.html'));
}

function hideWindow() {
  if (win && win.isVisible()) win.hide();
}

function showWindow() {
  // 不抢焦点，避免打断会议软件里的操作
  if (win && !win.isVisible()) win.showInactive();
}

async function answer() {
  const other = asr.cut();
  if (!other) {
    send('answer:error', { message: '还没有转写到对方的发言' });
    return;
  }
  if (answering) {
    answering.ctrl.abort();
    conversation.addTurn(answering.other, answering.text);
  }
  const current = { ctrl: new AbortController(), other, text: '' };
  answering = current;
  if (config.assistant.showOnAnswer) showWindow();
  send('answer:start', { other, turn: conversation.turns.length + 1 });

  try {
    await streamAnswer({
      config,
      system: conversation.systemPrompt,
      messages: conversation.buildMessages(other),
      maxTokens: config.assistant.maxTokens,
      signal: current.ctrl.signal,
      fetchImpl: (url, init) => net.fetch(url, init),
      onEvent: (e) => {
        if (current.ctrl.signal.aborted) return;
        if (e.type === 'delta') current.text += e.text;
        if (e.type === 'fallback') current.text = '';
        send('answer:event', e);
      },
    });
    if (answering === current) {
      conversation.addTurn(other, current.text);
      answering = null;
      send('answer:done', { turn: conversation.turns.length });
    }
  } catch (err) {
    if (current.ctrl.signal.aborted) return;
    conversation.addTurn(other, current.text);
    answering = null;
    send('answer:error', { message: `所有模型都调用失败：${err.message || err}` });
  }
}

function clearAll() {
  if (answering) answering.ctrl.abort();
  answering = null;
  conversation.clear();
  asr.clearTurn();
  send('answer:cleared', {});
}

function registerShortcuts() {
  const failed = [];
  const reg = (accel, fn) => {
    if (!globalShortcut.register(accel, fn)) failed.push(accel);
  };
  reg(SHORTCUTS.answer, () => answer());
  reg(SHORTCUTS.hide, hideWindow);
  reg(SHORTCUTS.show, showWindow);
  if (failed.length) {
    console.warn('快捷键注册失败（可能被其他程序占用）:', failed.join(', '));
    win.webContents.once('did-finish-load', () =>
      send('asr:status', { state: asr.state, message: `快捷键被占用：${failed.join(', ')}` })
    );
  }
}

function setupIpc() {
  ipcMain.handle('app:info', () => ({
    mode: MODE,
    hasTestAudio: !!asr.testAudioFile,
    shortcuts: SHORTCUTS,
    state: asr.state,
  }));
  ipcMain.handle('asr:start', async (_e, source) => {
    try {
      await asr.start(source);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('asr:stop', () => asr.stop());
  ipcMain.on('asr:audio', (_e, buf) => asr.pushAudio(Buffer.from(buf)));
  ipcMain.handle('assistant:answer', () => answer());
  ipcMain.handle('assistant:clear', () => clearAll());
  ipcMain.on('win:hide', hideWindow);
  ipcMain.on('win:quit', () => app.quit());

  asr.on('status', (s) => send('asr:status', s));
  asr.on('transcript', (t) => send('asr:transcript', t));
}

function setupSystemAudioCapture() {
  // 渲染进程调用 getDisplayMedia 时，直接选主屏幕 + 系统音频回环，不弹选择框
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch((err) => {
          console.error('获取屏幕源失败:', err);
          callback({});
        });
    },
    { useSystemPicker: false }
  );
}

app.whenReady().then(() => {
  try {
    config = loadConfig();
  } catch (err) {
    dialog.showErrorBox('配置错误', err.message);
    app.quit();
    return;
  }
  let testAudioFile = process.env.MA_TEST_AUDIO;
  if (testAudioFile && !path.isAbsolute(testAudioFile)) testAudioFile = path.join(ROOT, testAudioFile);
  if (testAudioFile && !fs.existsSync(testAudioFile)) testAudioFile = undefined;

  asr = new AsrController(config.xfyun, { testAudioFile });
  conversation = new Conversation(config.assistant);
  setupSystemAudioCapture();
  setupIpc();

  if (MODE === 'demo') {
    createDemoWindow();
  } else {
    createAssistantWindow();
    registerShortcuts();
  }

  if (process.env.MA_AUTOTEST) {
    require(path.join(ROOT, 'scripts', 'autotest.js'))({ app, win, asr, answer, hideWindow, showWindow, conversation, MODE });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (asr) asr.stop();
});

app.on('window-all-closed', () => app.quit());
