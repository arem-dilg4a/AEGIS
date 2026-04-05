const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  moveWindow:   (dx, dy) => ipcRenderer.invoke('move-window', { dx, dy }),
  resize:       (w, h)   => ipcRenderer.invoke('resize-window', { w, h }),
  openExternal: (url)    => ipcRenderer.invoke('open-external', url),
});
