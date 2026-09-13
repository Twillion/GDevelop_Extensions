'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wglexe', {
  boot: () => ipcRenderer.invoke('boot'),
  validateSource: (dir) => ipcRenderer.invoke('validate-source', dir),
  warnings: (settings) => ipcRenderer.invoke('warnings', settings),
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  pickIcon: () => ipcRenderer.invoke('pick-icon'),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  loadPreset: (file) => ipcRenderer.invoke('load-preset', file),
  savePreset: (name, settings) => ipcRenderer.invoke('save-preset', { name, settings }),
  reveal: (target) => ipcRenderer.invoke('reveal', target),
  package: (payload) => ipcRenderer.invoke('package', payload),
  onLog: (handler) => ipcRenderer.on('log', (_event, entry) => handler(entry)),
});
