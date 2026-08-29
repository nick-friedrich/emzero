import { randomUUID } from 'node:crypto';
import { ipcMain, safeStorage, shell } from 'electron';
import {
  ACCOUNT_CHANNELS,
  MICROSOFT_CLIENT_ID,
  type AccountDraft,
  type AccountBackupResult,
  type AccountNameUpdate,
  type AccountOperationResult,
  type AccountReorderResult,
  type FolderCreateRequest,
  type FolderListResult,
  type FolderMoveRequest,
  type FolderMutationResult,
  type FolderRenameRequest,
  type MailSearchRequest,
  type MailSearchResult,
  type MailSendDraft,
  type MailDraftReference,
  type MailSendResult,
  type MessageDetailResult,
  type MessageListResult,
  type MessageOperationResult,
} from '../shared/accounts.js';
import { verifyConnections, verifyMicrosoftConnections } from './account-connection.js';
import { exportAccountBackup, importAccountBackup, selectAccountBackup } from './account-backup.js';
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
  changeMessageFlagged,
  deleteFolderMessages,
  moveFolderMessages,
  validMessageUids,
} from './message-actions.js';
import { errorMessage, mailCache } from './mail-runtime.js';
import { getFolderMessage, listFolderMessages } from './message-reader.js';
import { deleteMailDraft, saveMailDraft } from './mail-drafts.js';
import { sendMessage } from './message-sender.js';
import {
  beginMicrosoftAuth,
  cancelMicrosoftAuth,
  finishMicrosoftAuth,
} from './microsoft-oauth.js';
import { discoverProvider, listProviders } from './provider-discovery.js';

async function saveConnectedAccount(
  draft: AccountDraft,
  secret: string,
): Promise<AccountOperationResult> {
  const insecureLinuxBackend =
    process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
  const asyncEncryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
  if (!safeStorage.isEncryptionAvailable() || !asyncEncryptionAvailable || insecureLinuxBackend) {
    return {
      ok: false,
      message:
        'Secure credential storage is unavailable. Unlock or configure your system keyring and try again.',
    };
  }

  const accounts = await readAccounts();
  if (accounts.some((account) => account.email.toLowerCase() === draft.email.toLowerCase())) {
    return { ok: false, message: 'An account with this email address already exists.' };
  }
  const authentication = draft.credentials.type;
  const account: StoredAccount = {
    id: randomUUID(),
    name: draft.name.trim(),
    email: draft.email.trim(),
    username: draft.username.trim(),
    imap: { ...draft.imap, host: draft.imap.host.trim() },
    smtp: { ...draft.smtp, host: draft.smtp.host.trim() },
    authentication,
    createdAt: new Date().toISOString(),
    encryptedSecret: (await safeStorage.encryptStringAsync(secret)).toString('base64'),
    ...(authentication === 'microsoft-oauth' ? { oauthClientId: MICROSOFT_CLIENT_ID } : {}),
  };

  await writeAccounts([...accounts, account]);
  return {
    ok: true,
    message: 'Account connected and saved securely.',
    account: toAccountSummary(account),
  };
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

function validDraftReference(value: unknown): value is MailDraftReference {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<MailDraftReference>;
  return (
    typeof draft.folderPath === 'string' &&
    Boolean(draft.folderPath) &&
    typeof draft.uid === 'number' &&
    Number.isSafeInteger(draft.uid) &&
    draft.uid > 0
  );
}

export function registerAccountHandlers(): void {
  ipcMain.handle(ACCOUNT_CHANNELS.openExternalLink, async (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      await shell.openExternal(url.toString());
      return true;
    } catch {
      return false;
    }
  });

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

  ipcMain.handle(ACCOUNT_CHANNELS.exportBackup, async (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const request = value as { password?: unknown; includeCredentials?: unknown } | null;
    if (!request || typeof request.password !== 'string' || typeof request.includeCredentials !== 'boolean') {
      return { ok: false, message: 'Invalid backup options.' } satisfies AccountBackupResult;
    }
    return exportAccountBackup(request.password, request.includeCredentials);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.selectBackup, async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return selectAccountBackup();
  });

  ipcMain.handle(ACCOUNT_CHANNELS.importBackup, async (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const request = value as { selectionId?: unknown; password?: unknown } | null;
    if (!request || typeof request.selectionId !== 'string' || typeof request.password !== 'string') {
      return { ok: false, message: 'Invalid backup import request.' } satisfies AccountBackupResult;
    }
    return importAccountBackup(request.selectionId, request.password);
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

  ipcMain.handle(ACCOUNT_CHANNELS.reorder, async (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const accounts = await readAccounts();
    if (
      !Array.isArray(value) ||
      value.length !== accounts.length ||
      value.some((id) => typeof id !== 'string') ||
      new Set(value).size !== accounts.length
    ) {
      return { ok: false, message: 'Invalid account order.' } satisfies AccountReorderResult;
    }
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const reordered = value.map((id) => byId.get(id));
    if (reordered.some((account) => !account)) {
      return { ok: false, message: 'Invalid account order.' } satisfies AccountReorderResult;
    }
    const nextAccounts = reordered as StoredAccount[];
    await writeAccounts(nextAccounts);
    return {
      ok: true,
      message: 'Account order updated.',
      accounts: nextAccounts.map(toAccountSummary),
    } satisfies AccountReorderResult;
  });

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
    ACCOUNT_CHANNELS.prefetchMessage,
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
      return getFolderMessage(account, folderPath, uid, 'prefetch');
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
    ACCOUNT_CHANNELS.setMessageFlagged,
    async (event, accountId: unknown, folderPath: unknown, uids: unknown, flagged: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        !validMessageUids(uids) ||
        typeof flagged !== 'boolean'
      ) {
        return { ok: false, message: 'Invalid messages.' } satisfies MessageOperationResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' } satisfies MessageOperationResult;
      return changeMessageFlagged(account, folderPath, uids, flagged);
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

  ipcMain.handle(
    ACCOUNT_CHANNELS.saveDraft,
    async (event, accountId: unknown, value: unknown, previous: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        !validSendDraft(value) ||
        (previous !== undefined && !validDraftReference(previous))
      ) {
        return { ok: false, message: 'Invalid draft.' };
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' };
      return saveMailDraft(account, value, previous);
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.deleteDraft,
    async (event, accountId: unknown, value: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || !validDraftReference(value)) {
        return { ok: false, message: 'Invalid draft.' };
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, message: 'Account not found.' };
      return deleteMailDraft(account, value);
    },
  );

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
    if (!draft?.credentials || draft.credentials.type !== 'password') {
      return { ok: false, message: 'Use Microsoft sign-in to connect this account.' };
    }
    const connectionResult = await verifyConnections(draft);
    if (!connectionResult.ok) return connectionResult;
    return saveConnectedAccount(draft, draft.credentials.password);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.beginMicrosoftAuth, async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return beginMicrosoftAuth(MICROSOFT_CLIENT_ID);
  });

  ipcMain.handle(
    ACCOUNT_CHANNELS.openMicrosoftAuthPage,
    async (event, verificationUri: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof verificationUri !== 'string') return false;
      try {
        const url = new URL(verificationUri);
        const microsoftHost =
          url.hostname === 'microsoft.com' ||
          url.hostname.endsWith('.microsoft.com') ||
          url.hostname === 'microsoftonline.com' ||
          url.hostname.endsWith('.microsoftonline.com');
        if (url.protocol !== 'https:' || !microsoftHost) return false;
        await shell.openExternal(url.toString());
        return true;
      } catch {
        return false;
      }
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.finishMicrosoftAuth,
    async (event, sessionId: unknown, draft: AccountDraft) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof sessionId !== 'string' ||
        !draft ||
        typeof draft !== 'object' ||
        draft.credentials?.type !== 'microsoft-oauth'
      ) {
        return { ok: false, message: 'Invalid Microsoft sign-in request.' };
      }
      try {
        const tokens = await finishMicrosoftAuth(sessionId);
        const connectionResult = await verifyMicrosoftConnections(draft, tokens.accessToken);
        if (!connectionResult.ok) return connectionResult;
        return saveConnectedAccount(draft, tokens.refreshToken);
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(error, ''),
        } satisfies AccountOperationResult;
      }
    },
  );

  ipcMain.handle(ACCOUNT_CHANNELS.cancelMicrosoftAuth, (event, sessionId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return typeof sessionId === 'string' && cancelMicrosoftAuth(sessionId);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.openGmailAppPasswordHelp, async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    await shell.openExternal('https://support.google.com/accounts/answer/185833');
  });
}
