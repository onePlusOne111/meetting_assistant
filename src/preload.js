const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  asrStart: (source) => ipcRenderer.invoke('asr:start', source),
  asrStop: () => ipcRenderer.invoke('asr:stop'),
  sendAudio: (buf) => ipcRenderer.send('asr:audio', buf),
  answer: () => ipcRenderer.invoke('assistant:answer'),
  clear: () => ipcRenderer.invoke('assistant:clear'),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('win:quit'),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),
});
