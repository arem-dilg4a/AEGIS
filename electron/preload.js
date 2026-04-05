const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Relative drag delta — called continuously during mousemove.
  // Electron moves the window immediately; no clamping here.
  moveWindow: (dx, dy) => ipcRenderer.invoke('move-window', { dx, dy }),

  // Fallback resize-only — used when set-bounds is unavailable.
  resize: (w, h) => ipcRenderer.invoke('resize-window', { w, h }),

  // Atomic reposition + resize.
  //
  // Args:
  //   orbX, orbY  — orb top-left in screen coordinates (not window coordinates)
  //   w, h        — desired window size
  //   orbD        — orb diameter
  //   panelW      — panel width
  //
  // Returns:
  //   Promise<'left' | 'right'> — the side Electron chose for the panel,
  //   so React can flip its flex-direction to match.
  //
  // IMPORTANT: orbX must be the orb's own screen X, NOT the window's screen X.
  // When the panel is open on the left, window.screenX !== orbX. The caller
  // (App.jsx applyBounds) is responsible for computing the correct orbX before
  // calling this method.
  setBounds: (orbX, orbY, w, h, orbD, panelW) =>
    ipcRenderer.invoke('set-bounds', { orbX, orbY, w, h, orbD, panelW }),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});