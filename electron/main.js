const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
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
  const s = 16, buf = Buffer.alloc(s*s*4);
  for (let y=0;y<s;y++) for (let x=0;x<s;x++) {
    const d=Math.sqrt((x-7.5)**2+(y-7.5)**2), i=(y*s+x)*4;
    const a=d<6?255:d<7?Math.round((7-d)*255):0;
    buf[i]=100;buf[i+1]=180;buf[i+2]=255;buf[i+3]=a;
  }
  tray = new Tray(nativeImage.createFromBuffer(buf,{width:s,height:s}));
  tray.setToolTip('AEGIS — Always On');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label:'Show AEGIS', click:()=>{ mainWindow.show(); mainWindow.focus(); } },
    { type:'separator' },
    { label:'Quit', click:()=>{ app._quitting=true; app.quit(); } },
  ]));
  tray.on('click', ()=>{ mainWindow.isVisible()?mainWindow.hide():mainWindow.show(); });
}

// Custom drag via IPC — avoids -webkit-app-region click conflicts
ipcMain.handle('move-window', (_, {dx, dy}) => {
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x+dx, y+dy);
});
ipcMain.handle('resize-window', (_, {w, h}) => {
  mainWindow.setSize(Math.round(w), Math.round(h), true);
});
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', (e) => e.preventDefault());
app.on('activate', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
app.on('before-quit', () => { app._quitting = true; });
