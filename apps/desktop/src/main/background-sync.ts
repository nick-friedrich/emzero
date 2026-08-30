import { BrowserWindow } from 'electron';
import { ACCOUNT_CHANNELS, type MailSyncStatus } from '../shared/accounts.js';
import { listAccountFolders } from './account-folders.js';
import { readAccounts, type StoredAccount } from './account-storage.js';
import { errorMessage, mailCache } from './mail-runtime.js';
import { listFolderMessages } from './message-reader.js';
import {
  newlyArrivedUnreadMessages,
  showNewMailNotification,
} from './mail-notifications.js';

let backgroundSyncTimer: NodeJS.Timeout | null = null;
let activeSync: Promise<MailSyncStatus> | null = null;
let syncStatus: MailSyncStatus = { state: 'idle', lastSyncedAt: null };

function publishSyncStatus(status: MailSyncStatus): void {
  syncStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.syncChanged, status);
  }
}

async function syncAccount(account: StoredAccount): Promise<void> {
  const folderResult = await listAccountFolders(account, true);
  if (!folderResult.ok || folderResult.source === 'cache') {
    throw new Error(folderResult.message ?? 'Could not refresh folders.');
  }
  const selectable = folderResult.folders.filter((folder) => folder.selectable);
  const prioritized = [
    ...selectable.filter((folder) => folder.specialUse === '\\Inbox'),
    ...selectable.filter((folder) => folder.specialUse === '\\Sent'),
  ];

  for (const folder of prioritized) {
    const beforeSync = folder.specialUse === '\\Inbox'
      ? mailCache().getFolderSyncState(account.id, folder.path)
      : null;
    const result = await listFolderMessages(account, folder.path, true);
    if (!result.ok || result.source === 'cache') {
      throw new Error(result.message ?? `Could not sync ${folder.name}.`);
    }
    if (beforeSync) {
      const afterSync = mailCache().getFolderSyncState(account.id, folder.path);
      showNewMailNotification(
        account.name,
        newlyArrivedUnreadMessages(
          beforeSync.messages,
          beforeSync.syncedAt,
          beforeSync.uidValidity,
          result.messages,
          afterSync.uidValidity,
        ),
      );
    }
  }
}

export function getBackgroundSyncStatus(): MailSyncStatus {
  return syncStatus;
}

export function runBackgroundSync(): Promise<MailSyncStatus> {
  if (activeSync) return activeSync;
  publishSyncStatus({ state: 'syncing', lastSyncedAt: syncStatus.lastSyncedAt });
  activeSync = (async () => {
    const accounts = await readAccounts();
    const results = await Promise.allSettled(accounts.map(syncAccount));
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${accounts[index].name}: ${errorMessage(result.reason, '')}`]
        : [],
    );
    const completedAt = new Date().toISOString();
    const nextStatus: MailSyncStatus = failures.length
      ? { state: 'error', lastSyncedAt: syncStatus.lastSyncedAt, message: failures.join(' · ') }
      : { state: 'idle', lastSyncedAt: completedAt };
    publishSyncStatus(nextStatus);
    return nextStatus;
  })().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export function startBackgroundSync(): void {
  if (backgroundSyncTimer) return;
  backgroundSyncTimer = setInterval(() => void runBackgroundSync(), 5 * 60_000);
}

export function stopBackgroundSync(): void {
  if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);
  backgroundSyncTimer = null;
}
