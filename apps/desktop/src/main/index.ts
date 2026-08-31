import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Menu, powerMonitor } from 'electron';
import { registerAccountHandlers } from './accounts.js';
import { startBackgroundSync, stopBackgroundSync } from './background-sync.js';
import { closeMailCache, disconnectPooledImapConnections } from './mail-runtime.js';
import { registerMailWindowHandlers } from './mail-windows.js';
import { setMailNotificationActivationHandler } from './mail-notifications.js';

let mainWindow: BrowserWindow | null = null;

const bundledAssets = path.join(app.getAppPath(), 'assets');
const assetsDirectory = existsSync(bundledAssets)
  ? bundledAssets
  : path.resolve(__dirname, '../../assets');
const appAsset = (fileName: string) => path.join(assetsDirectory, fileName);

app.setName('Emzero');

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
    minWidth: 400,
    minHeight: 600,
    backgroundColor: '#f5f5f4',
    icon: appAsset('emzero-logo.png'),
    show: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
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
  if (process.platform === 'darwin') {
    app.dock?.setIcon(appAsset('emzero-logo.png'));
    const applicationMenu = Menu.getApplicationMenu();
    if (applicationMenu?.items[0]) {
      applicationMenu.items[0].label = app.name;
      Menu.setApplicationMenu(applicationMenu);
    }
  }
  registerAccountHandlers();
  registerMailWindowHandlers();
  setMailNotificationActivationHandler(() => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  createWindow();
  startBackgroundSync();
  powerMonitor.on('suspend', disconnectPooledImapConnections);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopBackgroundSync();
  powerMonitor.removeListener('suspend', disconnectPooledImapConnections);
  closeMailCache();
});
