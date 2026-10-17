import type { ImapFlow } from 'imapflow';
import type { StoredAccount } from './account-storage.js';
import { closeImap, createImapClient, resolveMailSecret } from './mail-runtime.js';

/**
 * Keeps one dedicated IMAP connection per account parked in IDLE on the Inbox,
 * so the server pushes new-mail notices instead of waiting for the next
 * scheduled sync. Servers without IDLE fall back to ImapFlow's NOOP polling.
 */

interface InboxWatcher {
  fingerprint: string;
  imap: ImapFlow | null;
  stopped: boolean;
  retryTimer: NodeJS.Timeout | null;
  failures: number;
}

const watchers = new Map<string, InboxWatcher>();
let onInboxChanged: (accountId: string) => void = () => undefined;

// Re-issuing IDLE well inside common NAT and server timeouts keeps the socket alive.
const MAX_IDLE_TIME = 4 * 60_000;
const SOCKET_TIMEOUT = 10 * 60_000;
const MAX_RETRY_DELAY = 5 * 60_000;

function accountFingerprint(account: StoredAccount): string {
  return JSON.stringify([
    account.imap.host,
    account.imap.port,
    account.imap.secure,
    account.username,
    account.authentication,
    account.encryptedSecret,
  ]);
}

async function connectWatcher(account: StoredAccount, watcher: InboxWatcher): Promise<void> {
  const secret = await resolveMailSecret(account);
  if (watcher.stopped) return;
  const imap = createImapClient(account, secret, SOCKET_TIMEOUT, { maxIdleTime: MAX_IDLE_TIME });
  watcher.imap = imap;
  imap.on('exists', (event: { count: number; prevCount: number }) => {
    if (event.count > event.prevCount) onInboxChanged(account.id);
  });
  imap.on('close', () => {
    if (watcher.imap === imap) watcher.imap = null;
    scheduleReconnect(account, watcher);
  });
  await imap.connect();
  await imap.mailboxOpen('INBOX', { readOnly: true });
  watcher.failures = 0;
}

function scheduleReconnect(account: StoredAccount, watcher: InboxWatcher): void {
  if (watcher.stopped || watcher.retryTimer) return;
  const delay = Math.min(MAX_RETRY_DELAY, 5_000 * 2 ** watcher.failures);
  watcher.failures += 1;
  watcher.retryTimer = setTimeout(() => {
    watcher.retryTimer = null;
    startConnection(account, watcher);
  }, delay);
}

function startConnection(account: StoredAccount, watcher: InboxWatcher): void {
  if (watcher.stopped) return;
  connectWatcher(account, watcher).catch(() => {
    const imap = watcher.imap;
    watcher.imap = null;
    void closeImap(imap);
    scheduleReconnect(account, watcher);
  });
}

function stopWatcher(accountId: string): void {
  const watcher = watchers.get(accountId);
  if (!watcher) return;
  watchers.delete(accountId);
  watcher.stopped = true;
  if (watcher.retryTimer) clearTimeout(watcher.retryTimer);
  const imap = watcher.imap;
  watcher.imap = null;
  void closeImap(imap);
}

export function setInboxChangedHandler(handler: (accountId: string) => void): void {
  onInboxChanged = handler;
}

/** Starts watchers for new accounts, restarts changed ones, and stops removed ones. */
export function reconcileInboxWatchers(accounts: StoredAccount[]): void {
  const current = new Set(accounts.map((account) => account.id));
  for (const accountId of [...watchers.keys()]) {
    if (!current.has(accountId)) stopWatcher(accountId);
  }
  for (const account of accounts) {
    const fingerprint = accountFingerprint(account);
    const existing = watchers.get(account.id);
    if (existing?.fingerprint === fingerprint) {
      // A watcher backing off after a failure gets an immediate retry on each sync.
      if (!existing.imap && existing.retryTimer) {
        clearTimeout(existing.retryTimer);
        existing.retryTimer = null;
        startConnection(account, existing);
      }
      continue;
    }
    if (existing) stopWatcher(account.id);
    const watcher: InboxWatcher = {
      fingerprint,
      imap: null,
      stopped: false,
      retryTimer: null,
      failures: 0,
    };
    watchers.set(account.id, watcher);
    startConnection(account, watcher);
  }
}

export function stopInboxWatchers(): void {
  for (const accountId of [...watchers.keys()]) stopWatcher(accountId);
}
