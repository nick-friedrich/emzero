import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { ImapFlow, type FetchMessageObject, type FetchQueryObject } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountOperationResult,
  type AccountSummary,
  type FolderListResult,
  type MailAddressSummary,
  type MailFolderSummary,
  type MailMessageDetail,
  type MailMessageSummary,
  type MailSyncStatus,
  type MessageDetailResult,
  type MessageListResult,
  type MessageOperationResult,
  validateAccountDraft,
} from '../shared/accounts.js';
import { discoverProvider, listProviders } from './provider-discovery.js';
import { hasQuotedHtml, sanitizedMessageHtml } from './message-html.js';
import { MailCache } from './mail-cache.js';

interface StoredAccount extends AccountSummary {
  encryptedPassword: string;
}

const accountsPath = () => path.join(app.getPath('userData'), 'accounts.json');
let cache: MailCache | null = null;
let backgroundSyncTimer: NodeJS.Timeout | null = null;
let activeSync: Promise<MailSyncStatus> | null = null;
let syncStatus: MailSyncStatus = { state: 'idle', lastSyncedAt: null };

function publishSyncStatus(status: MailSyncStatus): void {
  syncStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.syncChanged, status);
  }
}

function mailCache(): MailCache {
  cache ??= new MailCache(path.join(app.getPath('userData'), 'mail-cache.sqlite'));
  return cache;
}

export function closeMailCache(): void {
  cache?.close();
  cache = null;
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
    ...selectable.filter(
      (folder) => folder.specialUse !== '\\Inbox' && folder.specialUse !== '\\Sent',
    ),
  ].slice(0, 6);

  for (const folder of prioritized) {
    const result = await listFolderMessages(account, folder.path, true);
    if (!result.ok || result.source === 'cache') {
      throw new Error(result.message ?? `Could not sync ${folder.name}.`);
    }
  }
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
  setTimeout(() => void runBackgroundSync(), 5_000);
  backgroundSyncTimer = setInterval(() => void runBackgroundSync(), 5 * 60_000);
}

export function stopBackgroundSync(): void {
  if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);
  backgroundSyncTimer = null;
}

async function readAccounts(): Promise<StoredAccount[]> {
  try {
    const value: unknown = JSON.parse(await readFile(accountsPath(), 'utf8'));
    return Array.isArray(value) ? (value as StoredAccount[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAccounts(accounts: StoredAccount[]): Promise<void> {
  const target = accountsPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function toSummary(account: StoredAccount): AccountSummary {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    username: account.username,
    imap: account.imap,
    smtp: account.smtp,
    createdAt: account.createdAt,
  };
}

function errorMessage(error: unknown, password: string): string {
  const message = error instanceof Error ? error.message : 'Unknown connection error';
  return password ? message.replaceAll(password, '••••••••') : message;
}

async function verifyConnections(draft: AccountDraft): Promise<AccountOperationResult> {
  const validationError = validateAccountDraft(draft);
  if (validationError) return { ok: false, message: validationError };

  const imap = new ImapFlow({
    host: draft.imap.host.trim(),
    port: draft.imap.port,
    secure: draft.imap.secure,
    auth: { user: draft.username.trim(), pass: draft.password },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 15_000,
  });

  const smtp = nodemailer.createTransport({
    host: draft.smtp.host.trim(),
    port: draft.smtp.port,
    secure: draft.smtp.secure,
    auth: { user: draft.username.trim(), pass: draft.password },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 15_000,
  });

  const [imapResult, smtpResult] = await Promise.allSettled([
    imap.connect().then(() => imap.logout()),
    smtp.verify(),
  ]);

  if (imapResult.status === 'rejected' || smtpResult.status === 'rejected') {
    if (imap.usable) await imap.logout().catch(() => undefined);
    smtp.close();
    const failures = [
      imapResult.status === 'rejected'
        ? `IMAP: ${errorMessage(imapResult.reason, draft.password)}`
        : null,
      smtpResult.status === 'rejected'
        ? `SMTP: ${errorMessage(smtpResult.reason, draft.password)}`
        : null,
    ].filter(Boolean);
    return { ok: false, message: failures.join(' · ') };
  }

  smtp.close();
  return { ok: true, message: 'IMAP and SMTP connections succeeded.' };
}

async function decryptPassword(account: StoredAccount): Promise<string> {
  const encrypted = Buffer.from(account.encryptedPassword, 'base64');
  const { result } = await safeStorage.decryptStringAsync(encrypted);
  return result;
}

async function listAccountFolders(
  account: StoredAccount,
  refresh = false,
): Promise<FolderListResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  const cachedFolders = mailCache().listFolders(account.id);

  if (cachedFolders.length > 0 && !refresh) {
    return { ok: true, folders: cachedFolders, source: 'cache' };
  }

  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 15_000,
    });
    await imap.connect();
    const folders: MailFolderSummary[] = (
      await imap.list({ statusQuery: { unseen: true } })
    ).map((folder) => ({
      path: folder.path,
      name: folder.name,
      parentPath: folder.parentPath,
      delimiter: folder.delimiter,
      specialUse: folder.specialUse ?? null,
      selectable: !folder.flags.has('\\Noselect'),
      unreadCount: folder.status?.unseen ?? 0,
    }));
    mailCache().replaceFolders(account.id, folders);
    return { ok: true, folders, source: 'server' };
  } catch (error) {
    if (cachedFolders.length > 0) {
      return {
        ok: true,
        folders: cachedFolders,
        source: 'cache',
        message: `Could not refresh folders. Showing saved data. ${errorMessage(error, password)}`,
      };
    }
    return {
      ok: false,
      folders: [],
      message: `Could not load folders: ${errorMessage(error, password)}`,
    };
  } finally {
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

function addresses(
  value: Array<{ name?: string; address?: string }> | undefined,
): MailAddressSummary[] {
  return (value ?? []).map(({ name, address }) => ({
    name: name ?? null,
    address: address ?? null,
  }));
}

function dateString(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function referenceIds(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (entry) => entry.match(/<[^>]+>/g) ?? entry.split(/\s+/).filter(Boolean),
  );
}

async function messageSummary(
  folderPath: string,
  message: FetchMessageObject,
): Promise<MailMessageSummary> {
  const parsedHeaders = message.headers
    ? await simpleParser(message.headers, { skipHtmlToText: true, skipTextToHtml: true })
    : null;
  return {
    folderPath,
    uid: message.uid,
    messageId: message.envelope?.messageId ?? null,
    inReplyTo: message.envelope?.inReplyTo ?? null,
    references: referenceIds(parsedHeaders?.references),
    subject: message.envelope?.subject?.trim() || '(No subject)',
    from: addresses(message.envelope?.from),
    to: addresses(message.envelope?.to),
    sentAt: dateString(message.envelope?.date),
    receivedAt: dateString(message.internalDate),
    unread: !message.flags?.has('\\Seen'),
    flagged: message.flags?.has('\\Flagged') ?? false,
    size: message.size ?? null,
  };
}

const summaryFetchQuery: FetchQueryObject = {
  uid: true,
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  headers: ['references'],
};

async function fetchSummaries(
  imap: ImapFlow,
  folderPath: string,
  range: string | number[],
  changedSince?: bigint,
): Promise<MailMessageSummary[]> {
  if (Array.isArray(range) && range.length === 0) return [];
  const messages: MailMessageSummary[] = [];
  for await (const message of imap.fetch(range, summaryFetchQuery, {
    uid: true,
    changedSince,
  })) {
    messages.push(await messageSummary(folderPath, message));
  }
  return messages;
}

async function listFolderMessages(
  account: StoredAccount,
  folderPath: string,
  refresh = false,
): Promise<MessageListResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  const cached = mailCache().getFolderSyncState(account.id, folderPath);

  if (cached.syncedAt && !refresh) {
    return { ok: true, ...cached, source: 'cache' };
  }

  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 20_000,
    });
    await imap.connect();
    lock = await imap.getMailboxLock(folderPath, { readOnly: true });

    if (!imap.mailbox) throw new Error('Mailbox did not open.');
    const mailbox = imap.mailbox;
    const remoteUids = (await imap.search({ all: true }, { uid: true })) || [];
    const uidValidity = mailbox.uidValidity.toString();
    const validityChanged = cached.uidValidity !== null && cached.uidValidity !== uidValidity;
    const cachedUids = new Set(validityChanged ? [] : mailCache().listMessageUids(account.id, folderPath));
    const missingUids = remoteUids.filter((uid) => !cachedUids.has(uid)).slice(-250);
    const recentUids = remoteUids.slice(-100);
    const summaries = new Map<number, MailMessageSummary>();

    if (
      !validityChanged &&
      cached.highestModseq &&
      mailbox.highestModseq &&
      mailbox.highestModseq > BigInt(cached.highestModseq)
    ) {
      for (const message of await fetchSummaries(
        imap,
        folderPath,
        '1:*',
        BigInt(cached.highestModseq),
      )) {
        summaries.set(message.uid, message);
      }
    }
    const requestedUids = [...new Set([...missingUids, ...recentUids])];
    for (const message of await fetchSummaries(imap, folderPath, requestedUids)) {
      summaries.set(message.uid, message);
    }

    mailCache().applyIncrementalSync(
      account.id,
      folderPath,
      [...summaries.values()],
      remoteUids,
      {
        uidValidity,
        uidNext: mailbox.uidNext,
        highestModseq: mailbox.highestModseq?.toString() ?? null,
      },
    );
    return { ok: true, ...mailCache().listMessages(account.id, folderPath), source: 'server' };
  } catch (error) {
    if (cached.syncedAt) {
      return {
        ok: true,
        ...cached,
        source: 'cache',
        message: `Could not refresh messages. Showing saved data. ${errorMessage(error, password)}`,
      };
    }
    return {
      ok: false,
      messages: [],
      total: 0,
      message: `Could not load messages: ${errorMessage(error, password)}`,
    };
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

function parsedAddresses(value: AddressObject | AddressObject[] | undefined): MailAddressSummary[] {
  const entries = (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (addressObject) => addressObject.value,
  );
  return entries.flatMap((entry) => {
    if (entry.group) {
      return entry.group.map(({ name, address }) => ({ name: name || null, address: address ?? null }));
    }
    return [{ name: entry.name || null, address: entry.address ?? null }];
  });
}

async function getFolderMessage(
  account: StoredAccount,
  folderPath: string,
  uid: number,
): Promise<MessageDetailResult> {
  const cachedBody = mailCache().getMessageBody(account.id, folderPath, uid);
  if (cachedBody) return { ok: true, messageDetail: cachedBody, source: 'cache' };

  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;

  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 30_000,
    });
    await imap.connect();
    lock = await imap.getMailboxLock(folderPath, { readOnly: true });

    const fetched = await imap.fetchOne(uid, { source: true }, { uid: true });
    if (!fetched || !fetched.source) {
      return { ok: false, message: 'This message is no longer available.' };
    }

    const parsed = await simpleParser(fetched.source);
    const messageDetail: MailMessageDetail = {
      uid,
      messageId: parsed.messageId ?? null,
      subject: parsed.subject?.trim() || '(No subject)',
      from: parsedAddresses(parsed.from),
      to: parsedAddresses(parsed.to),
      cc: parsedAddresses(parsed.cc),
      replyTo: parsedAddresses(parsed.replyTo),
      sentAt: dateString(parsed.date),
      text: parsed.text?.trim() || 'This message has no readable text content.',
      html: sanitizedMessageHtml(parsed.html),
      htmlHasQuotedText: hasQuotedHtml(parsed.html),
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename || 'Unnamed attachment',
        contentType: attachment.contentType,
        size: attachment.size,
        related: attachment.related,
      })),
    };
    mailCache().putMessageBody(account.id, folderPath, messageDetail);
    return { ok: true, messageDetail, source: 'server' };
  } catch (error) {
    return {
      ok: false,
      message: `Could not load message: ${errorMessage(error, password)}`,
    };
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

function validUids(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((uid) => typeof uid === 'number' && Number.isInteger(uid) && uid > 0)
  );
}

async function changeMessageUnread(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
  unread: boolean,
): Promise<MessageOperationResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 20_000,
    });
    await imap.connect();
    lock = await imap.getMailboxLock(folderPath);
    const changed = unread
      ? await imap.messageFlagsRemove(uids, ['\\Seen'], { uid: true })
      : await imap.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
    if (!changed) return { ok: false, message: 'The messages are no longer available.' };
    mailCache().setMessagesUnread(account.id, folderPath, uids, unread);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `Could not update messages: ${errorMessage(error, password)}` };
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

async function deleteFolderMessages(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
): Promise<MessageOperationResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 20_000,
    });
    await imap.connect();
    lock = await imap.getMailboxLock(folderPath);
    const trash = mailCache()
      .listFolders(account.id)
      .find((folder) => folder.selectable && folder.specialUse === '\\Trash');
    const deleted = trash && trash.path !== folderPath
      ? await imap.messageMove(uids, trash.path, { uid: true })
      : await imap.messageDelete(uids, { uid: true });
    if (!deleted) return { ok: false, message: 'The messages are no longer available.' };
    mailCache().deleteMessages(account.id, folderPath, uids);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `Could not delete messages: ${errorMessage(error, password)}` };
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) return false;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return senderUrl.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  }
  return senderUrl.startsWith('file://');
}

export function registerAccountHandlers(): void {
  ipcMain.handle(ACCOUNT_CHANNELS.syncStatus, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return syncStatus;
  });

  ipcMain.handle(ACCOUNT_CHANNELS.syncNow, async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return runBackgroundSync();
  });

  ipcMain.handle(ACCOUNT_CHANNELS.providers, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return listProviders();
  });

  ipcMain.handle(ACCOUNT_CHANNELS.discoverProvider, async (event, email: string) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return discoverProvider(email);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.list, async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return (await readAccounts()).map(toSummary);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.listFolders, async (event, accountId: unknown, refresh: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (typeof accountId !== 'string') {
      return { ok: false, folders: [], message: 'Invalid account.' } satisfies FolderListResult;
    }
    const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
    if (!account) {
      return { ok: false, folders: [], message: 'Account not found.' } satisfies FolderListResult;
    }
    return listAccountFolders(account, refresh === true);
  });

  ipcMain.handle(
    ACCOUNT_CHANNELS.listMessages,
    async (event, accountId: unknown, folderPath: unknown, refresh: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || typeof folderPath !== 'string' || !folderPath) {
        return {
          ok: false,
          messages: [],
          total: 0,
          message: 'Invalid mailbox.',
        } satisfies MessageListResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) {
        return {
          ok: false,
          messages: [],
          total: 0,
          message: 'Account not found.',
        } satisfies MessageListResult;
      }
      return listFolderMessages(account, folderPath, refresh === true);
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.getMessage,
    async (event, accountId: unknown, folderPath: unknown, uid: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        typeof uid !== 'number' ||
        !Number.isInteger(uid) ||
        uid < 1
      ) {
        return { ok: false, message: 'Invalid message.' } satisfies MessageDetailResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) {
        return { ok: false, message: 'Account not found.' } satisfies MessageDetailResult;
      }
      return getFolderMessage(account, folderPath, uid);
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.setMessageUnread,
    async (event, accountId: unknown, folderPath: unknown, uids: unknown, unread: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || typeof folderPath !== 'string' || !folderPath || !validUids(uids) || typeof unread !== 'boolean') {
        return { ok: false, message: 'Invalid messages.' } satisfies MessageOperationResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MessageOperationResult;
      return changeMessageUnread(account, folderPath, uids, unread);
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.deleteMessages,
    async (event, accountId: unknown, folderPath: unknown, uids: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || typeof folderPath !== 'string' || !folderPath || !validUids(uids)) {
        return { ok: false, message: 'Invalid messages.' } satisfies MessageOperationResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MessageOperationResult;
      return deleteFolderMessages(account, folderPath, uids);
    },
  );

  ipcMain.handle(ACCOUNT_CHANNELS.test, async (event, draft: AccountDraft) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return verifyConnections(draft);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.save, async (event, draft: AccountDraft) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const connectionResult = await verifyConnections(draft);
    if (!connectionResult.ok) return connectionResult;
    const insecureLinuxBackend =
      process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
    const asyncEncryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
    if (!safeStorage.isEncryptionAvailable() || !asyncEncryptionAvailable || insecureLinuxBackend) {
      return {
        ok: false,
        message:
          'Secure credential storage is unavailable. Unlock or configure your system keyring and try again.',
      } satisfies AccountOperationResult;
    }

    const accounts = await readAccounts();
    if (accounts.some((account) => account.email.toLowerCase() === draft.email.toLowerCase())) {
      return { ok: false, message: 'An account with this email address already exists.' };
    }

    const account: StoredAccount = {
      id: randomUUID(),
      name: draft.name.trim(),
      email: draft.email.trim(),
      username: draft.username.trim(),
      imap: { ...draft.imap, host: draft.imap.host.trim() },
      smtp: { ...draft.smtp, host: draft.smtp.host.trim() },
      createdAt: new Date().toISOString(),
      encryptedPassword: (await safeStorage.encryptStringAsync(draft.password)).toString('base64'),
    };

    await writeAccounts([...accounts, account]);
    void runBackgroundSync();
    return {
      ok: true,
      message: 'Account connected and saved securely.',
      account: toSummary(account),
    } satisfies AccountOperationResult;
  });
}
