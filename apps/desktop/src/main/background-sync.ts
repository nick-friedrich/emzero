import { BrowserWindow } from 'electron';
import { ACCOUNT_CHANNELS, type MailSyncStatus } from '../shared/accounts.js';
import { listAccountFolders } from './account-folders.js';
import { readAccounts, type StoredAccount } from './account-storage.js';
import { demoModeEnabled } from './demo-profile.js';
import { errorMessage, mailCache } from './mail-runtime.js';
import { listFolderMessages } from './message-reader.js';
import { scheduleMailInsights } from './mail-insights.js';
import {
  reconcileInboxWatchers,
  setInboxChangedHandler,
  stopInboxWatchers,
} from './inbox-watch.js';
import {
  newlyArrivedUnreadMessages,
  showNewMailNotification,
} from './mail-notifications.js';

let backgroundSyncTimer: NodeJS.Timeout | null = null;
let activeSync: Promise<MailSyncStatus> | null = null;
let syncStatus: MailSyncStatus = { state: 'idle', lastSyncedAt: null };
// Inbox syncs for one account run one at a time so a pushed sync and the
// scheduled sync never both report the same arrival.
const accountInboxQueues = new Map<string, Promise<void>>();
const pushedSyncTimers = new Map<string, NodeJS.Timeout>();

function publishSyncStatus(status: MailSyncStatus): void {
  syncStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.syncChanged, status);
  }
}

function publishMailboxChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.syncMailboxChanged);
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
    if (folder.specialUse === '\\Inbox') {
      await syncInbox(account, folder.path);
      continue;
    }
    const result = await listFolderMessages(account, folder.path, true);
    if (!result.ok || result.source === 'cache') {
      throw new Error(result.message ?? `Could not sync ${folder.name}.`);
    }
  }
}

function syncInbox(account: StoredAccount, folderPath: string): Promise<void> {
  const previous = accountInboxQueues.get(account.id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const beforeSync = mailCache().getFolderSyncState(account.id, folderPath);
    const result = await listFolderMessages(account, folderPath, true);
    if (!result.ok || result.source === 'cache') {
      throw new Error(result.message ?? 'Could not sync Inbox.');
    }
    const afterSync = mailCache().getFolderSyncState(account.id, folderPath);
    const arrived = newlyArrivedUnreadMessages(
      beforeSync.messages,
      beforeSync.syncedAt,
      beforeSync.uidValidity,
      result.messages,
      afterSync.uidValidity,
    );
    // The full sync can keep running for other accounts and folders; refresh
    // lists now so a notification never points at mail the list lacks.
    if (arrived.length > 0) publishMailboxChanged();
    showNewMailNotification(account.name, arrived);
  });
  accountInboxQueues.set(account.id, next);
  void next.finally(() => {
    if (accountInboxQueues.get(account.id) === next) accountInboxQueues.delete(account.id);
  }).catch(() => undefined);
  return next;
}

async function syncPushedInbox(accountId: string): Promise<void> {
  const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
  if (!account) return;
  const cachedFolders = mailCache().listFolders(account.id);
  const inbox = cachedFolders.find((folder) => folder.specialUse === '\\Inbox');
  await syncInbox(account, inbox?.path ?? 'INBOX');
  scheduleMailInsights();
}

/** Coalesces a burst of server push notices into one Inbox sync shortly after. */
function handleInboxPush(accountId: string): void {
  const pending = pushedSyncTimers.get(accountId);
  if (pending) clearTimeout(pending);
  pushedSyncTimers.set(
    accountId,
    setTimeout(() => {
      pushedSyncTimers.delete(accountId);
      void syncPushedInbox(accountId).catch(() => undefined);
    }, 1_500),
  );
}

export function getBackgroundSyncStatus(): MailSyncStatus {
  return syncStatus;
}

export function runBackgroundSync(): Promise<MailSyncStatus> {
  if (demoModeEnabled()) {
    publishSyncStatus({ state: 'idle', lastSyncedAt: new Date().toISOString() });
    return Promise.resolve(syncStatus);
  }
  if (activeSync) return activeSync;
  publishSyncStatus({ state: 'syncing', lastSyncedAt: syncStatus.lastSyncedAt });
  activeSync = (async () => {
    const accounts = await readAccounts();
    reconcileInboxWatchers(accounts);
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
    scheduleMailInsights();
    return nextStatus;
  })().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export function startBackgroundSync(): void {
  if (backgroundSyncTimer) return;
  setInboxChangedHandler(handleInboxPush);
  void readAccounts().then(reconcileInboxWatchers, () => undefined);
  backgroundSyncTimer = setInterval(() => void runBackgroundSync(), 5 * 60_000);
}

export function stopBackgroundSync(): void {
  if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);
  backgroundSyncTimer = null;
  for (const timer of pushedSyncTimers.values()) clearTimeout(timer);
  pushedSyncTimers.clear();
  stopInboxWatchers();
}

/** Sleep kills the push sockets; drop them now and resync right after wake. */
export function pauseInboxPushForSuspend(): void {
  stopInboxWatchers();
}

export function resumeInboxPushAfterWake(): void {
  if (backgroundSyncTimer) void runBackgroundSync();
}
