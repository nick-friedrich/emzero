import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Menu, powerMonitor } from 'electron';
import { registerAccountHandlers } from './accounts.js';
import { registerContextMenus } from './context-menu.js';
import {
  pauseInboxPushForSuspend,
  resumeInboxPushAfterWake,
  startBackgroundSync,
  stopBackgroundSync,
} from './background-sync.js';
import { seedDemoProfile } from './demo-dataset.js';
import { demoModeEnabled, useDemoProfileWhenRequested } from './demo-profile.js';
import { closeMailCache, disconnectPooledImapConnections } from './mail-runtime.js';
import { registerMailWindowHandlers } from './mail-windows.js';
import { setMailNotificationActivationHandler } from './mail-notifications.js';
import { scheduleMailInsights } from './mail-insights.js';
import { hiddenWindowWebPreferences, hideDockForHiddenWindows, revealWindow } from './window-visibility.js';

let mainWindow: BrowserWindow | null = null;

const bundledAssets = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(app.getAppPath(), 'assets');
const assetsDirectory = existsSync(bundledAssets)
  ? bundledAssets
  : path.resolve(__dirname, '../../assets');
const appAsset = (fileName: string) => path.join(assetsDirectory, fileName);

app.setName('Emzero');
useDemoProfileWhenRequested();

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
      ...hiddenWindowWebPreferences,
    },
  });

  if (process.platform === 'linux') mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) revealWindow(mainWindow);
  });
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

void app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // A runtime Dock icon is a static image that overrides the bundle's Icon
    // Composer icon and its appearance variants, so only set it in development.
    if (!app.isPackaged) app.dock?.setIcon(appAsset('emzero-logo-macos.png'));
    const applicationMenu = Menu.getApplicationMenu();
    if (applicationMenu?.items[0]) {
      applicationMenu.items[0].label = app.name;
      Menu.setApplicationMenu(applicationMenu);
    }
  }
  hideDockForHiddenWindows();
  registerContextMenus();
  if (demoModeEnabled()) await seedDemoProfile();
  registerAccountHandlers();
  registerMailWindowHandlers();
  setMailNotificationActivationHandler(() => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    if (mainWindow) revealWindow(mainWindow, { focus: true });
  });
  createWindow();
  if (!demoModeEnabled()) startBackgroundSync();
  scheduleMailInsights(5_000);
  powerMonitor.on('suspend', disconnectPooledImapConnections);
  powerMonitor.on('suspend', pauseInboxPushForSuspend);
  powerMonitor.on('resume', resumeInboxPushAfterWake);

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
  powerMonitor.removeListener('suspend', pauseInboxPushForSuspend);
  powerMonitor.removeListener('resume', resumeInboxPushAfterWake);
  closeMailCache();
});
