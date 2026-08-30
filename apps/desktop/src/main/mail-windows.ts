import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  ACCOUNT_CHANNELS,
  type MailDraftReference,
  type MailSendDraft,
  type MailWindowContext,
} from '../shared/accounts.js';

const mailWindowContexts = new Map<string, { context: MailWindowContext; webContentsId: number }>();

function validDraftReference(value: unknown): value is MailDraftReference {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<MailDraftReference>;
  return typeof draft.folderPath === 'string' && Boolean(draft.folderPath) &&
    typeof draft.uid === 'number' && Number.isSafeInteger(draft.uid) && draft.uid > 0;
}

function validDraft(value: unknown): value is MailSendDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<MailSendDraft>;
  const addresses = (items: unknown) => Array.isArray(items) && items.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const address = item as { name?: unknown; address?: unknown };
    return (address.name === null || typeof address.name === 'string') &&
      (address.address === null || typeof address.address === 'string');
  });
  return addresses(draft.to) && addresses(draft.cc) && addresses(draft.bcc) &&
    typeof draft.subject === 'string' && typeof draft.text === 'string' &&
    (draft.inReplyTo === null || typeof draft.inReplyTo === 'string') &&
    Array.isArray(draft.references) && draft.references.every((item) => typeof item === 'string') &&
    Array.isArray(draft.attachments) && draft.attachments.length <= 20 &&
    draft.attachments.every((item) => item && typeof item === 'object' &&
      typeof (item as { id?: unknown }).id === 'string' &&
      typeof (item as { filename?: unknown }).filename === 'string' &&
      typeof (item as { size?: unknown }).size === 'number');
}

function validContext(value: unknown): value is MailWindowContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<MailWindowContext>;
  if (context.kind === 'message') {
    return typeof context.accountId === 'string' && Boolean(context.accountId) &&
      typeof context.folderPath === 'string' && Boolean(context.folderPath) &&
      typeof context.uid === 'number' && Number.isSafeInteger(context.uid) && context.uid > 0;
  }
  if (context.kind !== 'composer') return false;
  return ['new', 'reply', 'draft'].includes(context.composerKind ?? '') &&
    typeof context.accountId === 'string' && Boolean(context.accountId) &&
    validDraft(context.draft) &&
    (context.draftReference === undefined || validDraftReference(context.draftReference));
}

function trustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  return MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : url.startsWith('file://');
}

export function registerMailWindowHandlers(): void {
  ipcMain.handle(ACCOUNT_CHANNELS.getMailWindowContext, (event, windowId: unknown) => {
    if (!trustedSender(event)) throw new Error('Untrusted IPC sender');
    if (typeof windowId !== 'string') return null;
    const entry = mailWindowContexts.get(windowId);
    return entry?.webContentsId === event.sender.id ? entry.context : null;
  });

  ipcMain.handle(ACCOUNT_CHANNELS.openMailWindow, async (event, value: unknown) => {
    if (!trustedSender(event)) throw new Error('Untrusted IPC sender');
    if (!validContext(value)) return false;

    const mailWindow = new BrowserWindow({
      width: value.kind === 'message' ? 1040 : 760,
      height: value.kind === 'message' ? 820 : 720,
      minWidth: 480,
      minHeight: 560,
      backgroundColor: '#f5f5f4',
      icon: path.join(app.getAppPath(), 'assets', 'emzero-logo.png'),
      show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    if (process.platform === 'linux') mailWindow.setMenu(null);
    mailWindow.once('ready-to-show', () => mailWindow.show());
    mailWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mailWindow.webContents.on('will-navigate', (navigationEvent) => navigationEvent.preventDefault());

    const windowId = randomUUID();
    mailWindowContexts.set(windowId, { context: value, webContentsId: mailWindow.webContents.id });
    mailWindow.once('closed', () => mailWindowContexts.delete(windowId));
    const hash = `mail-window=${windowId}`;
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      url.hash = hash;
      await mailWindow.loadURL(url.toString());
    } else {
      await mailWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        { hash },
      );
    }
    return true;
  });
}
