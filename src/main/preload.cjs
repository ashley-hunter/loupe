const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('loupe', {
  index: () => ipcRenderer.invoke('loupe:index'),
  session: (path) => ipcRenderer.invoke('loupe:session', path),
  reveal: (path) => ipcRenderer.invoke('loupe:reveal', path),
  cache: () => ipcRenderer.invoke('loupe:cache'),
  findings: () => ipcRenderer.invoke('loupe:findings'),
  advice: () => ipcRenderer.invoke('loupe:advice'),
  projects: () => ipcRenderer.invoke('loupe:projects'),
  search: (query, kind) => ipcRenderer.invoke('loupe:search', query, kind),
  startLive: () => ipcRenderer.invoke('loupe:live-start'),
  stopLive: () => ipcRenderer.invoke('loupe:live-stop'),
  onAlerts: (fn) => {
    const handler = (_e, alerts) => fn(alerts);
    ipcRenderer.on('loupe:alerts', handler);
    return () => ipcRenderer.off('loupe:alerts', handler);
  },
  onLive: (fn) => {
    const handler = (_e, detail) => fn(detail);
    ipcRenderer.on('loupe:live', handler);
    return () => ipcRenderer.off('loupe:live', handler);
  },
  usage: () => ipcRenderer.invoke('loupe:usage'),
  setPollInterval: (minutes) => ipcRenderer.invoke('loupe:poll-interval', minutes),
  onUsageSample: (fn) => {
    const handler = (_e, sample) => fn(sample);
    ipcRenderer.on('loupe:usage-sample', handler);
    return () => ipcRenderer.off('loupe:usage-sample', handler);
  },
  alertHistory: () => ipcRenderer.invoke('loupe:alert-history'),
  onOpenAlert: (fn) => {
    const handler = (_e, alert) => fn(alert);
    ipcRenderer.on('loupe:open-alert', handler);
    return () => ipcRenderer.off('loupe:open-alert', handler);
  },
  updateState: () => ipcRenderer.invoke('loupe:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('loupe:update-check'),
  installUpdate: () => ipcRenderer.invoke('loupe:update-install'),
  onUpdate: (fn) => {
    const handler = (_e, status) => fn(status);
    ipcRenderer.on('loupe:update', handler);
    return () => ipcRenderer.off('loupe:update', handler);
  },
  platform: process.platform,
});
