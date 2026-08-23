import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import {
  closeMailCache,
  registerAccountHandlers,
  startBackgroundSync,
  stopBackgroundSync,
} from './accounts.js';

let mainWindow: BrowserWindow | null = null;

const linuxDesktop = process.env.XDG_CURRENT_DESKTOP?.toLowerCase().split(':') ?? [];
if (
  process.platform === 'linux' &&
  linuxDesktop.includes('hyprland') &&
  !app.commandLine.hasSwitch('password-store')
) {
  // Chromium does not auto-detect a password store for Hyprland. Omarchy runs
  // the freedesktop Secret Service through GNOME Keyring, so select it explicitly.
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f5f5f4',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === 'linux') mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.once('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

void app.whenReady().then(() => {
  registerAccountHandlers();
  createWindow();
  startBackgroundSync();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopBackgroundSync();
  closeMailCache();
});
