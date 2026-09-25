const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('countdown', {
  onUpdate: (callback) => ipcRenderer.on('countdown', (_event, value) => callback(value)),
  onTheme: (callback) => ipcRenderer.on('theme-changed', (_event, value) => callback(value))
});
