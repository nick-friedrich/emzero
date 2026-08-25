import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain, safeStorage } from 'electron';
import { ImapFlow } from 'imapflow';
import {
  ACCOUNT_CHANNELS,
  chunkMessageUids,
  findArchiveFolder,
  type AccountDraft,
  type AccountOperationResult,
  type AccountNameUpdate,
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
  type MailFolderSummary,
  type MailSearchRequest,
  type MailSearchResult,
  type MailSendDraft,
  type MailSendResult,
  type MessageDetailResult,
  type MessageListResult,
  type MessageOperationResult,
} from '../shared/accounts.js';
import { discoverProvider, listProviders } from './provider-discovery.js';
import {
  createAccountFolder,
  deleteAccountFolder,
  listAccountFolders,
  moveAccountFolder,
  renameAccountFolder,
} from './account-folders.js';
import {
  readAccounts,
  toAccountSummary,
  writeAccounts,
  type StoredAccount,
} from './account-storage.js';
import { decryptPassword, errorMessage, mailCache } from './mail-runtime.js';
import { getFolderMessage, listFolderMessages } from './message-reader.js';
import { sendMessage } from './message-sender.js';
import { getBackgroundSyncStatus, runBackgroundSync } from './background-sync.js';
import { verifyConnections } from './account-connection.js';


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
      (group.destinationAccountId !== undefined &&
        (typeof group.destinationAccountId !== 'string' || !group.destinationAccountId)) ||
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
  destinationAccount: StoredAccount,
  destinationPath: string,
): Promise<MessageOperationResult> {
  if (destinationAccount.id !== account.id) {
    try {
      await transferFolderMessages(account, folderPath, uids, destinationAccount, destinationPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `Could not move messages: ${errorMessage(error, '')}` };
    }
  }
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

function appendableFlags(flags: Set<string> | undefined): string[] {
  const supported = new Set(['\\seen', '\\answered', '\\flagged', '\\draft']);
  return [...(flags ?? [])].filter((flag) => supported.has(flag.toLowerCase()));
}

async function transferFolderMessages(
  sourceAccount: StoredAccount,
  sourcePath: string,
  uids: number[],
  destinationAccount: StoredAccount,
  destinationPath: string,
  onTransferred?: (uid: number) => void,
  shouldStop?: () => boolean,
): Promise<void> {
  const destination = mailCache()
    .listFolders(destinationAccount.id)
    .find((folder) => folder.path === destinationPath && folder.selectable);
  if (!destination) throw new Error('Choose a valid destination folder.');

  let sourcePassword = '';
  let destinationPassword = '';
  let sourceImap: ImapFlow | null = null;
  let destinationImap: ImapFlow | null = null;
  let sourceLock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    [sourcePassword, destinationPassword] = await Promise.all([
      decryptPassword(sourceAccount),
      decryptPassword(destinationAccount),
    ]);
    sourceImap = new ImapFlow({
      host: sourceAccount.imap.host,
      port: sourceAccount.imap.port,
      secure: sourceAccount.imap.secure,
      auth: { user: sourceAccount.username, pass: sourcePassword },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 30_000,
    });
    destinationImap = new ImapFlow({
      host: destinationAccount.imap.host,
      port: destinationAccount.imap.port,
      secure: destinationAccount.imap.secure,
      auth: { user: destinationAccount.username, pass: destinationPassword },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 30_000,
    });
    await Promise.all([sourceImap.connect(), destinationImap.connect()]);
    sourceLock = await sourceImap.getMailboxLock(sourcePath);

    for (const uid of uids) {
      if (shouldStop?.()) return;
      const message = await sourceImap.fetchOne(
        uid,
        { source: true, flags: true, internalDate: true },
        { uid: true },
      );
      if (!message || !message.source) throw new Error('A source message is no longer available.');
      const appended = await destinationImap.append(
        destination.path,
        message.source,
        appendableFlags(message.flags),
        message.internalDate,
      );
      if (!appended) throw new Error('The destination server did not accept a message.');
      const deleted = await sourceImap.messageDelete(uid, { uid: true });
      if (!deleted) {
        throw new Error('A message was copied, but could not be removed from the source account.');
      }
      mailCache().transferMessages(
        sourceAccount.id,
        sourcePath,
        destinationAccount.id,
        destination.path,
        [uid],
      );
      onTransferred?.(uid);
    }
  } catch (error) {
    const sourceSafeMessage = errorMessage(error, sourcePassword);
    const safeMessage = destinationPassword
      ? sourceSafeMessage.replaceAll(destinationPassword, '••••••••')
      : sourceSafeMessage;
    throw new Error(safeMessage, { cause: error });
  } finally {
    sourceLock?.release();
    for (const imap of [sourceImap, destinationImap]) {
      if (imap?.usable) await imap.logout().catch(() => imap.close());
      else imap?.close();
    }
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
      const destinationAccount = group.destinationAccountId
        ? accounts.find((candidate) => candidate.id === group.destinationAccountId)
        : account;
      if (job.action === 'move' && destinationAccount?.id !== account.id) {
        if (!destinationAccount || !group.destinationPath) {
          throw new Error('Destination account not found.');
        }
        await transferFolderMessages(
          account,
          group.folderPath,
          group.uids,
          destinationAccount,
          group.destinationPath,
          (uid) => {
            job.processed += 1;
            const folder = mailCache()
              .listFolders(account.id)
              .find((candidate) => candidate.path === group.folderPath);
            publishBulkMessageProgress(
              bulkJobProgress(job, job.cancelRequested ? 'stopping' : 'running', {
                accountId: account.id,
                folderPath: group.folderPath,
                processedUids: [uid],
                folder,
              }),
            );
          },
          () => job.cancelRequested,
        );
      } else {
        await processBulkMessageGroup(job, account, group);
      }
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
    return getBackgroundSyncStatus();
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
    return (await readAccounts()).map(toAccountSummary);
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
        account: toAccountSummary(account),
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
      destinationAccountId: unknown,
      destinationPath: unknown,
    ) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        !validUids(uids) ||
        typeof destinationAccountId !== 'string' ||
        !destinationAccountId ||
        typeof destinationPath !== 'string' ||
        !destinationPath
      ) {
        return { ok: false, message: 'Invalid messages.' } satisfies MessageOperationResult;
      }
      const accounts = await readAccounts();
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MessageOperationResult;
      const destinationAccount = accounts.find((candidate) => candidate.id === destinationAccountId);
      if (!destinationAccount) {
        return { ok: false, message: 'Destination account not found.' } satisfies MessageOperationResult;
      }
      return moveFolderMessages(account, folderPath, uids, destinationAccount, destinationPath);
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
          ...(group.destinationAccountId
            ? { destinationAccountId: group.destinationAccountId }
            : {}),
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
      account: toAccountSummary(account),
    } satisfies AccountOperationResult;
  });
}
