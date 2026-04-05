const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen } = require('electron');
const path = require('path');

let mainWindow;
let tray;
const isDev = process.env.NODE_ENV === 'development';

app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, name: 'AEGIS' });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 200, height: 200,
    frame: false, transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true, resizable: false,
    skipTaskbar: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webSecurity: false,
    },
    show: false,
  });

  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  mainWindow.once('ready-to-show', () => {
    const { wasOpenedAsHidden } = app.getLoginItemSettings();
    if (!wasOpenedAsHidden) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app._quitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  const s = 16, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2), i = (y * s + x) * 4;
    const a = d < 6 ? 255 : d < 7 ? Math.round((7 - d) * 255) : 0;
    buf[i] = 100; buf[i + 1] = 180; buf[i + 2] = 255; buf[i + 3] = a;
  }
  tray = new Tray(nativeImage.createFromBuffer(buf, { width: s, height: s }));
  tray.setToolTip('AEGIS — Always On');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show AEGIS', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app._quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); });
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

// Relative drag delta — moves the window by a pixel delta.
// Called continuously during drag. No clamping here; set-bounds handles
// clamping on drag end.
ipcMain.handle('move-window', (_, { dx, dy }) => {
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

// Simple resize without repositioning — fallback when set-bounds is unavailable.
ipcMain.handle('resize-window', (_, { w, h }) => {
  mainWindow.setSize(Math.round(w), Math.round(h), false);
});

// Atomic reposition + resize.
//
// React passes:
//   orbX, orbY  — the orb's current top-left in screen coordinates
//   w, h        — the desired new window size
//   orbD        — orb diameter (the fixed part of the window)
//   panelW      — panel width (the expandable part)
//
// This handler owns ALL multi-monitor math:
//   1. Finds the correct display for the current orb position.
//   2. Decides which side (left/right) the panel should open on.
//   3. Computes the window top-left so the orb stays anchored.
//   4. Clamps everything to the display's work area.
//   5. Returns the chosen side ('left'|'right') so React can flip its layout.
//
// FIX: The previous version had a subtle bug where it used orbX directly as
// the window X for the right-side case, but on subsequent calls orbX was
// already the window X (because the panel was already open), causing the
// window to drift left by panelW on every resize. We now always re-derive
// the window X fresh from the orb anchor and the chosen side.
ipcMain.handle('set-bounds', (_, { orbX, orbY, w, h, orbD, panelW }) => {
  // Use the display that contains the orb's centre point.
  const display = screen.getDisplayNearestPoint({ x: orbX + orbD / 2, y: orbY + orbD / 2 });
  const { x: ax, y: ay, width: aw, height: ah } = display.workArea;

  // Decide side: prefer right; fall back to left if there isn't enough room.
  const spaceRight = (ax + aw) - (orbX + orbD);
  const spaceLeft  = orbX - ax;
  const side = spaceRight >= panelW + 40 ? 'right' : 'left';

  // Anchor the orb: place the window so its orb section stays at orbX/orbY.
  //   right → window starts at the orb's left edge (panel extends rightward)
  //   left  → window starts panelW to the left of the orb (panel extends leftward)
  let winX = side === 'right' ? orbX : orbX - (w - orbD);
  let winY = orbY;

  // Clamp to this display's work area so the window is never off-screen.
  winX = Math.round(Math.max(ax, Math.min(winX, ax + aw - w)));
  winY = Math.round(Math.max(ay, Math.min(winY, ay + ah - h)));

  mainWindow.setBounds(
    { x: winX, y: winY, width: Math.round(w), height: Math.round(h) },
    false  // animate = false for instant repositioning
  );

  // Return chosen side so React can flip its flex layout direction.
  return side;
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// ─── BOOT ─────────────────────────────────────────────────────────────────────

app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', (e) => e.preventDefault());
app.on('activate', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
app.on('before-quit', () => { app._quitting = true; });