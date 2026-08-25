import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { ImapFlow, type FetchMessageObject, type FetchQueryObject } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import {
  ACCOUNT_CHANNELS,
  chunkMessageUids,
  findArchiveFolder,
  manageableFolder,
  type AccountDraft,
  type AccountOperationResult,
  type AccountNameUpdate,
  type AccountSummary,
  type BulkMessageAction,
  type BulkMessageGroup,
  type BulkMessageJobProgress,
  type BulkMessageJobRequest,
  type BulkMessageJobStartResult,
  type FolderListResult,
  type FolderCreateRequest,
  type FolderMoveRequest,
  type FolderMutationResult,
  type FolderRenameRequest,
  type MailAddressSummary,
  type MailFolderSummary,
  type MailMessageDetail,
  type MailMessageSummary,
  type MailSearchRequest,
  type MailSearchResult,
  type MailSendDraft,
  type MailSendResult,
  type MailSyncStatus,
  type MessageDetailResult,
  type MessageListResult,
  type MessageOperationResult,
  validateAccountDraft,
} from '../shared/accounts.js';
import { validateReplyDraft, validateSendDraft } from '../shared/replies.js';
import { discoverProvider, listProviders } from './provider-discovery.js';
import { hasQuotedHtml, sanitizedMessageHtml } from './message-html.js';
import { subscribeListedFolders } from './folder-subscriptions.js';
import { MailCache } from './mail-cache.js';

interface StoredAccount extends AccountSummary {
  encryptedPassword: string;
}

const accountsPath = () => path.join(app.getPath('userData'), 'accounts.json');
let cache: MailCache | null = null;
let backgroundSyncTimer: NodeJS.Timeout | null = null;
let activeSync: Promise<MailSyncStatus> | null = null;
let syncStatus: MailSyncStatus = { state: 'idle', lastSyncedAt: null };

interface ActiveBulkMessageJob {
  id: string;
  action: BulkMessageAction;
  total: number;
  processed: number;
  cancelRequested: boolean;
}

let activeBulkMessageJob: ActiveBulkMessageJob | null = null;
const bulkMessageChunkSize = 50;

function publishBulkMessageProgress(progress: BulkMessageJobProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.bulkMessageJobChanged, progress);
  }
}

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

async function refreshedFolders(imap: ImapFlow, accountId: string): Promise<MailFolderSummary[]> {
  const listedFolders = await imap.list({ statusQuery: { unseen: true } });
  await subscribeListedFolders(imap, listedFolders);
  const folders: MailFolderSummary[] = listedFolders.map((folder) => ({
    path: folder.path,
    name: folder.name,
    parentPath: folder.parentPath,
    delimiter: folder.delimiter,
    specialUse: folder.specialUse ?? null,
    selectable: !folder.flags.has('\\Noselect'),
    unreadCount: folder.status?.unseen ?? 0,
  }));
  mailCache().replaceFolders(accountId, folders);
  return mailCache().listFolders(accountId);
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
    const folders = await refreshedFolders(imap, account.id);
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

function validFolderName(name: string, delimiter: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed) &&
    trimmed.length <= 200 &&
    !trimmed.includes(delimiter) &&
    !/[\r\n\0]/.test(trimmed);
}

function folderPath(parentPath: string, name: string, delimiter: string): string {
  return parentPath ? `${parentPath}${delimiter}${name}` : name;
}

async function mutateAccountFolders(
  account: StoredAccount,
  operation: (imap: ImapFlow) => Promise<void>,
): Promise<FolderMutationResult> {
  let password = '';
  let imap: ImapFlow | null = null;
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
    await operation(imap);
    return { ok: true, folders: await refreshedFolders(imap, account.id), source: 'server' };
  } catch (error) {
    return {
      ok: false,
      folders: mailCache().listFolders(account.id),
      message: `Could not update folders: ${errorMessage(error, password)}`,
    };
  } finally {
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

async function createAccountFolder(
  account: StoredAccount,
  request: FolderCreateRequest,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const parent = request.parentPath
    ? folders.find((folder) => folder.path === request.parentPath)
    : undefined;
  if (request.parentPath && !parent) {
    return { ok: false, folders, message: 'The parent folder no longer exists.' };
  }
  const delimiter = parent?.delimiter ?? folders[0]?.delimiter ?? '/';
  const name = request.name.trim();
  if (!validFolderName(name, delimiter)) {
    return { ok: false, folders, message: `Folder names cannot contain “${delimiter}”.` };
  }
  const path = folderPath(request.parentPath, name, delimiter);
  if (folders.some((folder) => folder.path === path)) {
    return { ok: false, folders, message: 'A folder with this name already exists here.' };
  }
  return mutateAccountFolders(account, async (imap) => {
    await imap.mailboxCreate(path);
  });
}

async function renameAccountFolder(
  account: StoredAccount,
  request: FolderRenameRequest,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const folder = folders.find((candidate) => candidate.path === request.folderPath);
  if (!folder || !manageableFolder(folder)) {
    return { ok: false, folders, message: 'This provider-managed folder cannot be renamed.' };
  }
  const name = request.name.trim();
  if (!validFolderName(name, folder.delimiter)) {
    return { ok: false, folders, message: `Folder names cannot contain “${folder.delimiter}”.` };
  }
  const nextPath = folderPath(folder.parentPath, name, folder.delimiter);
  if (nextPath === folder.path) return { ok: true, folders, source: 'cache' };
  if (folders.some((candidate) => candidate.path === nextPath)) {
    return { ok: false, folders, message: 'A folder with this name already exists here.' };
  }
  const siblings = folders.filter((candidate) => candidate.parentPath === folder.parentPath);
  const currentIndex = siblings.findIndex((candidate) => candidate.path === folder.path);
  const beforePath = siblings[currentIndex + 1]?.path ?? null;
  const result = await mutateAccountFolders(account, async (imap) => {
    await imap.mailboxRename(folder.path, nextPath);
  });
  if (!result.ok) return result;
  const orderedPaths = result.folders
    .filter((candidate) => candidate.parentPath === folder.parentPath && candidate.path !== nextPath)
    .map((candidate) => candidate.path);
  const beforeIndex = beforePath ? orderedPaths.indexOf(beforePath) : orderedPaths.length;
  orderedPaths.splice(beforeIndex < 0 ? orderedPaths.length : beforeIndex, 0, nextPath);
  mailCache().reorderFolderSiblings(account.id, folder.parentPath, orderedPaths);
  return { ...result, folders: mailCache().listFolders(account.id) };
}

async function moveAccountFolder(
  account: StoredAccount,
  request: FolderMoveRequest,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const folder = folders.find((candidate) => candidate.path === request.folderPath);
  if (!folder || !manageableFolder(folder)) {
    return { ok: false, folders, message: 'This provider-managed folder cannot be moved.' };
  }
  const parent = request.parentPath
    ? folders.find((candidate) => candidate.path === request.parentPath)
    : undefined;
  if (request.parentPath && !parent) {
    return { ok: false, folders, message: 'The destination folder no longer exists.' };
  }
  if (
    request.parentPath === folder.path ||
    (request.parentPath && request.parentPath.startsWith(`${folder.path}${folder.delimiter}`))
  ) {
    return { ok: false, folders, message: 'A folder cannot be moved inside itself.' };
  }
  const nextPath = folderPath(request.parentPath, folder.name, folder.delimiter);
  if (nextPath !== folder.path && folders.some((candidate) => candidate.path === nextPath)) {
    return { ok: false, folders, message: 'A folder with this name already exists there.' };
  }

  const applyOrder = (freshFolders: MailFolderSummary[], movedPath: string) => {
    const siblings = freshFolders
      .filter((candidate) => candidate.parentPath === request.parentPath && candidate.path !== movedPath)
      .map((candidate) => candidate.path);
    const beforeIndex = request.beforePath ? siblings.indexOf(request.beforePath) : siblings.length;
    if (request.beforePath && beforeIndex < 0) {
      throw new Error('The drop position is no longer available.');
    }
    siblings.splice(beforeIndex, 0, movedPath);
    mailCache().reorderFolderSiblings(account.id, request.parentPath, siblings);
  };

  if (nextPath === folder.path) {
    try {
      applyOrder(folders, folder.path);
      return { ok: true, folders: mailCache().listFolders(account.id), source: 'cache' };
    } catch (error) {
      return { ok: false, folders, message: errorMessage(error, '') };
    }
  }

  const result = await mutateAccountFolders(account, async (imap) => {
    await imap.mailboxRename(folder.path, nextPath);
  });
  if (!result.ok) return result;
  try {
    applyOrder(result.folders, nextPath);
    return { ...result, folders: mailCache().listFolders(account.id) };
  } catch (error) {
    return { ok: false, folders: result.folders, message: errorMessage(error, '') };
  }
}

async function deleteAccountFolder(
  account: StoredAccount,
  targetPath: string,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const folder = folders.find((candidate) => candidate.path === targetPath);
  if (!folder || !manageableFolder(folder)) {
    return { ok: false, folders, message: 'This provider-managed folder cannot be deleted.' };
  }
  return mutateAccountFolders(account, async (imap) => {
    await imap.mailboxDelete(folder.path);
  });
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

function validBulkMessageJobRequest(value: unknown): value is BulkMessageJobRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<BulkMessageJobRequest>;
  if (!['read', 'unread', 'archive', 'move', 'delete'].includes(request.action ?? '')) return false;
  if (!Array.isArray(request.groups) || request.groups.length === 0 || request.groups.length > 100) {
    return false;
  }
  let total = 0;
  for (const group of request.groups) {
    if (
      !group ||
      typeof group.accountId !== 'string' ||
      !group.accountId ||
      typeof group.folderPath !== 'string' ||
      !group.folderPath ||
      (request.action === 'move' &&
        (typeof group.destinationPath !== 'string' || !group.destinationPath)) ||
      !validUids(group.uids)
    ) {
      return false;
    }
    total += group.uids.length;
  }
  return total <= 20_000;
}

function moveDestination(
  accountId: string,
  folderPath: string,
  action: 'archive' | 'move',
  destinationPath?: string,
): MailFolderSummary | undefined {
  const folders = mailCache().listFolders(accountId);
  const destination =
    action === 'archive'
      ? findArchiveFolder(folders)
      : folders.find((folder) => folder.path === destinationPath && folder.selectable);
  return destination?.path === folderPath ? undefined : destination;
}

function validSendDraft(value: unknown): value is MailSendDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<MailSendDraft>;
  const validAddresses = (addresses: unknown) =>
    Array.isArray(addresses) &&
    addresses.every(
      (address) =>
        address !== null &&
        typeof address === 'object' &&
        ((address as { name?: unknown }).name === null ||
          typeof (address as { name?: unknown }).name === 'string') &&
        ((address as { address?: unknown }).address === null ||
          typeof (address as { address?: unknown }).address === 'string'),
    );
  return (
    validAddresses(draft.to) &&
    validAddresses(draft.cc) &&
    validAddresses(draft.bcc) &&
    typeof draft.subject === 'string' &&
    typeof draft.text === 'string' &&
    (draft.inReplyTo === null || typeof draft.inReplyTo === 'string') &&
    Array.isArray(draft.references) &&
    draft.references.every((reference) => typeof reference === 'string')
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

async function moveFolderMessages(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
  destinationPath: string,
): Promise<MessageOperationResult> {
  const destination = moveDestination(account.id, folderPath, 'move', destinationPath);
  if (!destination) return { ok: false, message: 'Choose a different destination folder.' };

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
    const moved = await imap.messageMove(uids, destination.path, { uid: true });
    if (!moved) return { ok: false, message: 'The messages are no longer available.' };
    mailCache().moveMessages(account.id, folderPath, destination.path, uids);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `Could not move messages: ${errorMessage(error, password)}` };
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

function bulkJobProgress(
  job: ActiveBulkMessageJob,
  state: BulkMessageJobProgress['state'],
  update: Partial<BulkMessageJobProgress> = {},
): BulkMessageJobProgress {
  return {
    jobId: job.id,
    action: job.action,
    state,
    total: job.total,
    processed: job.processed,
    ...update,
  };
}

async function processBulkMessageGroup(
  job: ActiveBulkMessageJob,
  account: StoredAccount,
  group: BulkMessageGroup,
): Promise<void> {
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
    lock = await imap.getMailboxLock(group.folderPath);
    const trash =
      job.action === 'delete'
        ? mailCache()
            .listFolders(account.id)
            .find((folder) => folder.selectable && folder.specialUse === '\\Trash')
        : undefined;
    const moveTo =
      job.action === 'archive' || job.action === 'move'
        ? moveDestination(account.id, group.folderPath, job.action, group.destinationPath)
        : undefined;
    if ((job.action === 'archive' || job.action === 'move') && !moveTo) {
      throw new Error(
        job.action === 'archive'
          ? 'This account does not have an Archive folder.'
          : 'Choose a different destination folder.',
      );
    }

    for (const uids of chunkMessageUids(group.uids, bulkMessageChunkSize)) {
      if (job.cancelRequested) return;
      const changed =
        job.action === 'read'
          ? await imap.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
          : job.action === 'unread'
            ? await imap.messageFlagsRemove(uids, ['\\Seen'], { uid: true })
            : moveTo
              ? await imap.messageMove(uids, moveTo.path, { uid: true })
            : trash && trash.path !== group.folderPath
              ? await imap.messageMove(uids, trash.path, { uid: true })
              : await imap.messageDelete(uids, { uid: true });
      if (!changed) throw new Error('The messages are no longer available.');

      if (job.action === 'delete') {
        mailCache().deleteMessages(account.id, group.folderPath, uids);
      } else if (moveTo) {
        mailCache().moveMessages(account.id, group.folderPath, moveTo.path, uids);
      } else {
        mailCache().setMessagesUnread(account.id, group.folderPath, uids, job.action === 'unread');
      }
      job.processed += uids.length;
      const folder = mailCache()
        .listFolders(account.id)
        .find((candidate) => candidate.path === group.folderPath);
      publishBulkMessageProgress(
        bulkJobProgress(job, job.cancelRequested ? 'stopping' : 'running', {
          accountId: account.id,
          folderPath: group.folderPath,
          processedUids: uids,
          folder,
        }),
      );
    }
  } catch (error) {
    throw new Error(errorMessage(error, password), { cause: error });
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

async function runBulkMessageJob(
  job: ActiveBulkMessageJob,
  request: BulkMessageJobRequest,
): Promise<void> {
  try {
    const accounts = await readAccounts();
    for (const group of request.groups) {
      if (job.cancelRequested) break;
      const account = accounts.find((candidate) => candidate.id === group.accountId);
      if (!account) throw new Error('Account not found.');
      await processBulkMessageGroup(job, account, group);
    }
    if (!job.cancelRequested) {
      for (const accountId of new Set(request.groups.map((group) => group.accountId))) {
        const account = accounts.find((candidate) => candidate.id === accountId);
        if (!account) continue;
        const result = await listAccountFolders(account, true).catch(() => null);
        if (!result?.ok) continue;
        for (const group of request.groups.filter((candidate) => candidate.accountId === accountId)) {
          publishBulkMessageProgress(
            bulkJobProgress(job, job.cancelRequested ? 'stopping' : 'running', {
              accountId,
              folderPath: group.folderPath,
              folder: result.folders.find((folder) => folder.path === group.folderPath),
            }),
          );
        }
      }
    }
    publishBulkMessageProgress(
      bulkJobProgress(job, job.cancelRequested ? 'stopped' : 'completed'),
    );
  } catch (error) {
    publishBulkMessageProgress(
      bulkJobProgress(job, 'error', {
        message: `The bulk action stopped: ${errorMessage(error, '')}`,
      }),
    );
  } finally {
    if (activeBulkMessageJob?.id === job.id) activeBulkMessageJob = null;
  }
}

async function sendMessage(
  account: StoredAccount,
  draft: MailSendDraft,
  kind: 'reply' | 'message',
): Promise<MailSendResult> {
  const validationError = kind === 'reply' ? validateReplyDraft(draft) : validateSendDraft(draft);
  if (validationError) return { ok: false, message: validationError };
  const sentLabel = kind === 'reply' ? 'Reply' : 'Message';

  let password = '';
  try {
    password = await decryptPassword(account);
    const sentAt = new Date();
    const messageOptions = {
      from: { name: account.name, address: account.email },
      to: draft.to.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      cc: draft.cc.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      bcc: draft.bcc.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      subject: draft.subject.trim(),
      text: draft.text.trim(),
      date: sentAt,
      inReplyTo: draft.inReplyTo ?? undefined,
      references: draft.references,
    };
    const compiler = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'windows',
    });
    const compiled = await compiler.sendMail(messageOptions);
    if (!Buffer.isBuffer(compiled.message)) throw new Error('Could not create the email message.');

    const smtp = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.username, pass: password },
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 30_000,
    });
    let smtpMessageId = compiled.messageId;
    try {
      const result = await smtp.sendMail({
        raw: compiled.message,
        envelope: compiled.envelope,
      });
      smtpMessageId = result.messageId || smtpMessageId;
    } finally {
      smtp.close();
    }

    let imap: ImapFlow | null = null;
    let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
    try {
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
      const folders = await imap.list();
      const sentFolder = folders.find(
        (folder) => !folder.flags.has('\\Noselect') && folder.specialUse === '\\Sent',
      );
      if (!sentFolder) {
        return {
          ok: true,
          message: `${sentLabel} sent, but this account has no Sent folder to save a copy in.`,
          messageId: smtpMessageId,
          savedToSent: false,
        };
      }

      lock = await imap.getMailboxLock(sentFolder.path);
      const existing = await imap.search(
        { header: { 'message-id': smtpMessageId } },
        { uid: true },
      );
      let sentUid = existing && existing.length > 0 ? existing.at(-1) : undefined;
      if (!sentUid) {
        const appended = await imap.append(sentFolder.path, compiled.message, ['\\Seen'], sentAt);
        if (!appended) throw new Error('The mail server did not save the Sent copy.');
        sentUid = appended.uid;
      }
      if (!sentUid) {
        const saved = await imap.search(
          { header: { 'message-id': smtpMessageId } },
          { uid: true },
        );
        sentUid = saved && saved.length > 0 ? saved.at(-1) : undefined;
      }

      const sentMessage: MailMessageSummary | undefined = sentUid
        ? {
            folderPath: sentFolder.path,
            uid: sentUid,
            messageId: smtpMessageId,
            inReplyTo: draft.inReplyTo,
            references: draft.references,
            subject: draft.subject.trim(),
            from: [{ name: account.name, address: account.email }],
            to: draft.to,
            sentAt: sentAt.toISOString(),
            receivedAt: null,
            unread: false,
            flagged: false,
            size: compiled.message.length,
          }
        : undefined;
      if (
        sentMessage &&
        mailCache().listFolders(account.id).some((folder) => folder.path === sentFolder.path)
      ) {
        const cached = mailCache().listMessages(account.id, sentFolder.path);
        const alreadyCached = cached.messages.some((message) => message.uid === sentMessage.uid);
        mailCache().replaceRecentMessages(
          account.id,
          sentFolder.path,
          [...cached.messages.filter((message) => message.uid !== sentMessage.uid), sentMessage],
          Math.max(cached.total, cached.messages.length) + (alreadyCached ? 0 : 1),
        );
        mailCache().putMessageBody(account.id, sentFolder.path, {
          uid: sentMessage.uid,
          messageId: sentMessage.messageId,
          subject: sentMessage.subject,
          from: sentMessage.from,
          to: sentMessage.to,
          cc: draft.cc,
          replyTo: [],
          sentAt: sentMessage.sentAt,
          text: draft.text.trim(),
          html: null,
          htmlHasQuotedText: false,
          attachments: [],
        });
      }
      return {
        ok: true,
        message: `${sentLabel} sent and saved to Sent.`,
        messageId: smtpMessageId,
        savedToSent: true,
        sentMessage,
      };
    } catch (error) {
      return {
        ok: true,
        message: `${sentLabel} sent, but the Sent copy could not be saved: ${errorMessage(error, password)}`,
        messageId: smtpMessageId,
        savedToSent: false,
      };
    } finally {
      lock?.release();
      if (imap?.usable) await imap.logout().catch(() => imap?.close());
      else imap?.close();
    }
  } catch (error) {
    return {
      ok: false,
      message: `Could not send ${kind === 'reply' ? 'reply' : 'message'}: ${errorMessage(error, password)}`,
    };
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

  ipcMain.handle(
    ACCOUNT_CHANNELS.update,
    async (event, accountId: unknown, update: AccountNameUpdate) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        !update ||
        typeof update !== 'object' ||
        typeof update.name !== 'string' ||
        !update.name.trim()
      ) {
        return { ok: false, message: 'Enter a name for this account.' } satisfies AccountOperationResult;
      }
      const accounts = await readAccounts();
      const index = accounts.findIndex((candidate) => candidate.id === accountId);
      if (index < 0) {
        return { ok: false, message: 'Account not found.' } satisfies AccountOperationResult;
      }
      const account = { ...accounts[index], name: update.name.trim() };
      accounts[index] = account;
      await writeAccounts(accounts);
      return {
        ok: true,
        message: 'Account name updated.',
        account: toSummary(account),
      } satisfies AccountOperationResult;
    },
  );

  ipcMain.handle(ACCOUNT_CHANNELS.remove, async (event, accountId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (typeof accountId !== 'string') {
      return { ok: false, message: 'Invalid account.' } satisfies AccountOperationResult;
    }
    const accounts = await readAccounts();
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return { ok: false, message: 'Account not found.' } satisfies AccountOperationResult;
    }
    await writeAccounts(accounts.filter((candidate) => candidate.id !== accountId));
    mailCache().deleteAccount(accountId);
    return { ok: true, message: 'Account deleted.' } satisfies AccountOperationResult;
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

  ipcMain.handle(ACCOUNT_CHANNELS.createFolder, async (event, accountId: unknown, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const request = value as Partial<FolderCreateRequest> | null;
    if (
      typeof accountId !== 'string' ||
      !request ||
      typeof request.name !== 'string' ||
      typeof request.parentPath !== 'string'
    ) {
      return { ok: false, folders: [], message: 'Invalid folder.' } satisfies FolderMutationResult;
    }
    const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
    if (!account) return { ok: false, folders: [], message: 'Account not found.' } satisfies FolderMutationResult;
    return createAccountFolder(account, request as FolderCreateRequest);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.renameFolder, async (event, accountId: unknown, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const request = value as Partial<FolderRenameRequest> | null;
    if (
      typeof accountId !== 'string' ||
      !request ||
      typeof request.folderPath !== 'string' ||
      !request.folderPath ||
      typeof request.name !== 'string'
    ) {
      return { ok: false, folders: [], message: 'Invalid folder.' } satisfies FolderMutationResult;
    }
    const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
    if (!account) return { ok: false, folders: [], message: 'Account not found.' } satisfies FolderMutationResult;
    return renameAccountFolder(account, request as FolderRenameRequest);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.moveFolder, async (event, accountId: unknown, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const request = value as Partial<FolderMoveRequest> | null;
    if (
      typeof accountId !== 'string' ||
      !request ||
      typeof request.folderPath !== 'string' ||
      !request.folderPath ||
      typeof request.parentPath !== 'string' ||
      (request.beforePath !== null && typeof request.beforePath !== 'string')
    ) {
      return { ok: false, folders: [], message: 'Invalid folder move.' } satisfies FolderMutationResult;
    }
    const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
    if (!account) return { ok: false, folders: [], message: 'Account not found.' } satisfies FolderMutationResult;
    return moveAccountFolder(account, request as FolderMoveRequest);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.deleteFolder, async (event, accountId: unknown, folderPath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (typeof accountId !== 'string' || typeof folderPath !== 'string' || !folderPath) {
      return { ok: false, folders: [], message: 'Invalid folder.' } satisfies FolderMutationResult;
    }
    const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
    if (!account) return { ok: false, folders: [], message: 'Account not found.' } satisfies FolderMutationResult;
    return deleteAccountFolder(account, folderPath);
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

  ipcMain.handle(ACCOUNT_CHANNELS.searchMessages, (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (!value || typeof value !== 'object') {
      return { ok: false, items: [], message: 'Invalid search.' } satisfies MailSearchResult;
    }
    const request = value as Partial<MailSearchRequest>;
    if (
      typeof request.query !== 'string' ||
      request.query.length > 500 ||
      (request.accountId !== undefined && typeof request.accountId !== 'string') ||
      (request.folderPath !== undefined && typeof request.folderPath !== 'string') ||
      (request.limit !== undefined &&
        (typeof request.limit !== 'number' || !Number.isInteger(request.limit))) ||
      (request.sort !== undefined &&
        !['relevance', 'newest', 'oldest'].includes(request.sort))
    ) {
      return { ok: false, items: [], message: 'Invalid search.' } satisfies MailSearchResult;
    }
    return {
      ok: true,
      items: mailCache().searchMessages(request.query, {
        accountId: request.accountId,
        folderPath: request.folderPath,
        limit: request.limit,
        sort: request.sort,
      }),
    } satisfies MailSearchResult;
  });

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

  ipcMain.handle(
    ACCOUNT_CHANNELS.moveMessages,
    async (
      event,
      accountId: unknown,
      folderPath: unknown,
      uids: unknown,
      destinationPath: unknown,
    ) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        !validUids(uids) ||
        typeof destinationPath !== 'string' ||
        !destinationPath
      ) {
        return { ok: false, message: 'Invalid messages.' } satisfies MessageOperationResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MessageOperationResult;
      return moveFolderMessages(account, folderPath, uids, destinationPath);
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.startBulkMessageJob,
    (event, value: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (!validBulkMessageJobRequest(value)) {
        return {
          ok: false,
          message: 'Invalid bulk message action.',
        } satisfies BulkMessageJobStartResult;
      }
      if (activeBulkMessageJob) {
        return {
          ok: false,
          message: 'Another bulk message action is already running.',
        } satisfies BulkMessageJobStartResult;
      }
      const request: BulkMessageJobRequest = {
        action: value.action,
        groups: value.groups.map((group) => ({
          accountId: group.accountId,
          folderPath: group.folderPath,
          uids: [...new Set(group.uids)],
          ...(group.destinationPath ? { destinationPath: group.destinationPath } : {}),
        })),
      };
      const job: ActiveBulkMessageJob = {
        id: randomUUID(),
        action: request.action,
        total: request.groups.reduce((total, group) => total + group.uids.length, 0),
        processed: 0,
        cancelRequested: false,
      };
      activeBulkMessageJob = job;
      publishBulkMessageProgress(bulkJobProgress(job, 'running'));
      void runBulkMessageJob(job, request);
      return { ok: true, jobId: job.id } satisfies BulkMessageJobStartResult;
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.cancelBulkMessageJob,
    (event, jobId: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof jobId !== 'string' || activeBulkMessageJob?.id !== jobId) return false;
      activeBulkMessageJob.cancelRequested = true;
      publishBulkMessageProgress(bulkJobProgress(activeBulkMessageJob, 'stopping'));
      return true;
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.sendReply,
    async (event, accountId: unknown, draft: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || !validSendDraft(draft)) {
        return { ok: false, message: 'Invalid reply.' } satisfies MailSendResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MailSendResult;
      return sendMessage(account, draft, 'reply');
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.sendMessage,
    async (event, accountId: unknown, draft: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || !validSendDraft(draft)) {
        return { ok: false, message: 'Invalid message.' } satisfies MailSendResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MailSendResult;
      return sendMessage(account, draft, 'message');
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.suggestRecipients,
    async (event, accountId: unknown, query: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || typeof query !== 'string') return [];
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return [];
      return mailCache().searchRecipients(account.id, query.slice(0, 200), [
        account.email,
        account.username,
      ]);
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
