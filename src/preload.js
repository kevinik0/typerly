const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('typerly', {
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  startTyping: (delayMs) => ipcRenderer.invoke('typing:start', delayMs),
  cancelTyping: () => ipcRenderer.invoke('typing:cancel'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  setShortcutRecording: (recording) => ipcRenderer.invoke('shortcut:recording', recording),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  onClipboardChanged: (callback) => ipcRenderer.on('clipboard-changed', (_event, text) => callback(text)),
  onStatusChanged: (callback) => ipcRenderer.on('status-changed', (_event, data) => callback(data)),
  onTypingFinished: (callback) => ipcRenderer.on('typing-finished', (_event, data) => callback(data)),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, data) => callback(data))
});
