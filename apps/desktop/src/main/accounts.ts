import { randomUUID } from 'node:crypto';
import { ipcMain, safeStorage } from 'electron';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountNameUpdate,
  type AccountOperationResult,
  type FolderCreateRequest,
  type FolderListResult,
  type FolderMoveRequest,
  type FolderMutationResult,
  type FolderRenameRequest,
  type MailSearchRequest,
  type MailSearchResult,
  type MailSendDraft,
  type MailSendResult,
  type MessageDetailResult,
  type MessageListResult,
  type MessageOperationResult,
} from '../shared/accounts.js';
import { verifyConnections } from './account-connection.js';
import { saveMessageAttachment, selectOutgoingAttachments } from './attachment-files.js';
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
import { getBackgroundSyncStatus, runBackgroundSync } from './background-sync.js';
import { cancelBulkMessageJob, startBulkMessageJob } from './bulk-message-jobs.js';
import {
  changeMessageUnread,
  deleteFolderMessages,
  moveFolderMessages,
  validMessageUids,
} from './message-actions.js';
import { mailCache } from './mail-runtime.js';
import { getFolderMessage, listFolderMessages } from './message-reader.js';
import { sendMessage } from './message-sender.js';
import { discoverProvider, listProviders } from './provider-discovery.js';

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
    draft.references.every((reference) => typeof reference === 'string') &&
    Array.isArray(draft.attachments) &&
    draft.attachments.length <= 20 &&
    draft.attachments.every(
      (attachment) =>
        attachment !== null &&
        typeof attachment === 'object' &&
        typeof attachment.id === 'string' &&
        Boolean(attachment.id) &&
        typeof attachment.filename === 'string' &&
        Boolean(attachment.filename) &&
        typeof attachment.size === 'number' &&
        Number.isSafeInteger(attachment.size) &&
        attachment.size >= 0,
    )
  );
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
        return { ok: false, messages: [], total: 0, message: 'Invalid mailbox.' } satisfies MessageListResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) {
        return { ok: false, messages: [], total: 0, message: 'Account not found.' } satisfies MessageListResult;
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
      (request.sort !== undefined && !['relevance', 'newest', 'oldest'].includes(request.sort))
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
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MessageDetailResult;
      return getFolderMessage(account, folderPath, uid);
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.setMessageUnread,
    async (event, accountId: unknown, folderPath: unknown, uids: unknown, unread: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        !validMessageUids(uids) ||
        typeof unread !== 'boolean'
      ) {
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
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        !validMessageUids(uids)
      ) {
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
        !validMessageUids(uids) ||
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

  ipcMain.handle(ACCOUNT_CHANNELS.startBulkMessageJob, (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return startBulkMessageJob(value);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.cancelBulkMessageJob, (event, jobId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return cancelBulkMessageJob(jobId);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.selectAttachments, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return selectOutgoingAttachments();
  });

  ipcMain.handle(
    ACCOUNT_CHANNELS.saveAttachment,
    async (
      event,
      accountId: unknown,
      folderPath: unknown,
      uid: unknown,
      attachmentIndex: unknown,
    ) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        typeof uid !== 'number' ||
        !Number.isSafeInteger(uid) ||
        uid < 1 ||
        typeof attachmentIndex !== 'number' ||
        !Number.isSafeInteger(attachmentIndex) ||
        attachmentIndex < 0
      ) {
        return { ok: false, message: 'Invalid attachment.' };
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' };
      return saveMessageAttachment(account, folderPath, uid, attachmentIndex);
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
