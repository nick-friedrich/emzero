import { contextBridge, ipcRenderer } from 'electron';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountOperationResult,
  type AccountNameUpdate,
  type AccountSummary,
  type BulkMessageJobProgress,
  type BulkMessageJobRequest,
  type BulkMessageJobStartResult,
  type FolderListResult,
  type FolderCreateRequest,
  type FolderMoveRequest,
  type FolderMutationResult,
  type FolderRenameRequest,
  type MessageListResult,
  type MessageDetailResult,
  type MessageOperationResult,
  type MailProvider,
  type MailReplyDraft,
  type MailSearchRequest,
  type MailSearchResult,
  type MailSendDraft,
  type MailSendResult,
  type MailSyncStatus,
  type MailDraftReference,
  type MailDraftSaveResult,
  type ProviderDiscoveryResult,
  type RecipientSuggestion,
  type AttachmentSaveResult,
  type AttachmentSelectionResult,
} from '../shared/accounts.js';

export interface EmzeroDesktopApi {
  platform: NodeJS.Platform;
  accounts: {
    list: () => Promise<AccountSummary[]>;
    test: (draft: AccountDraft) => Promise<AccountOperationResult>;
    save: (draft: AccountDraft) => Promise<AccountOperationResult>;
    update: (accountId: string, update: AccountNameUpdate) => Promise<AccountOperationResult>;
    remove: (accountId: string) => Promise<AccountOperationResult>;
  };
  folders: {
    list: (accountId: string, refresh?: boolean) => Promise<FolderListResult>;
    create: (accountId: string, request: FolderCreateRequest) => Promise<FolderMutationResult>;
    rename: (accountId: string, request: FolderRenameRequest) => Promise<FolderMutationResult>;
    move: (accountId: string, request: FolderMoveRequest) => Promise<FolderMutationResult>;
    delete: (accountId: string, folderPath: string) => Promise<FolderMutationResult>;
  };
  messages: {
    list: (accountId: string, folderPath: string, refresh?: boolean) => Promise<MessageListResult>;
    search: (request: MailSearchRequest) => Promise<MailSearchResult>;
    get: (accountId: string, folderPath: string, uid: number) => Promise<MessageDetailResult>;
    setUnread: (
      accountId: string,
      folderPath: string,
      uids: number[],
      unread: boolean,
    ) => Promise<MessageOperationResult>;
    setFlagged: (
      accountId: string,
      folderPath: string,
      uids: number[],
      flagged: boolean,
    ) => Promise<MessageOperationResult>;
    delete: (
      accountId: string,
      folderPath: string,
      uids: number[],
    ) => Promise<MessageOperationResult>;
    move: (
      accountId: string,
      folderPath: string,
      uids: number[],
      destinationAccountId: string,
      destinationPath: string,
    ) => Promise<MessageOperationResult>;
    startBulkJob: (request: BulkMessageJobRequest) => Promise<BulkMessageJobStartResult>;
    cancelBulkJob: (jobId: string) => Promise<boolean>;
    onBulkJobProgress: (listener: (progress: BulkMessageJobProgress) => void) => () => void;
    sendReply: (accountId: string, draft: MailReplyDraft) => Promise<MailSendResult>;
    send: (accountId: string, draft: MailSendDraft) => Promise<MailSendResult>;
    suggestRecipients: (accountId: string, query: string) => Promise<RecipientSuggestion[]>;
    selectAttachments: () => Promise<AttachmentSelectionResult>;
    saveAttachment: (
      accountId: string,
      folderPath: string,
      uid: number,
      attachmentIndex: number,
    ) => Promise<AttachmentSaveResult>;
    saveDraft: (
      accountId: string,
      draft: MailSendDraft,
      previous?: MailDraftReference,
    ) => Promise<MailDraftSaveResult>;
    deleteDraft: (
      accountId: string,
      draft: MailDraftReference,
    ) => Promise<MessageOperationResult>;
  };
  sync: {
    status: () => Promise<MailSyncStatus>;
    now: () => Promise<MailSyncStatus>;
    onStatus: (listener: (status: MailSyncStatus) => void) => () => void;
  };
  providers: {
    list: () => Promise<MailProvider[]>;
    discover: (email: string) => Promise<ProviderDiscoveryResult>;
  };
}

contextBridge.exposeInMainWorld('emzero', {
  platform: process.platform,
  accounts: {
    list: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.list),
    test: (draft) => ipcRenderer.invoke(ACCOUNT_CHANNELS.test, draft),
    save: (draft) => ipcRenderer.invoke(ACCOUNT_CHANNELS.save, draft),
    update: (accountId, update) => ipcRenderer.invoke(ACCOUNT_CHANNELS.update, accountId, update),
    remove: (accountId) => ipcRenderer.invoke(ACCOUNT_CHANNELS.remove, accountId),
  },
  folders: {
    list: (accountId, refresh = false) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.listFolders, accountId, refresh),
    create: (accountId, request) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.createFolder, accountId, request),
    rename: (accountId, request) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.renameFolder, accountId, request),
    move: (accountId, request) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.moveFolder, accountId, request),
    delete: (accountId, folderPath) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.deleteFolder, accountId, folderPath),
  },
  messages: {
    list: (accountId, folderPath, refresh = false) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.listMessages, accountId, folderPath, refresh),
    search: (request) => ipcRenderer.invoke(ACCOUNT_CHANNELS.searchMessages, request),
    get: (accountId, folderPath, uid) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.getMessage, accountId, folderPath, uid),
    setUnread: (accountId, folderPath, uids, unread) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.setMessageUnread, accountId, folderPath, uids, unread),
    setFlagged: (accountId, folderPath, uids, flagged) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.setMessageFlagged, accountId, folderPath, uids, flagged),
    delete: (accountId, folderPath, uids) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.deleteMessages, accountId, folderPath, uids),
    move: (accountId, folderPath, uids, destinationAccountId, destinationPath) =>
      ipcRenderer.invoke(
        ACCOUNT_CHANNELS.moveMessages,
        accountId,
        folderPath,
        uids,
        destinationAccountId,
        destinationPath,
      ),
    startBulkJob: (request) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.startBulkMessageJob, request),
    cancelBulkJob: (jobId) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.cancelBulkMessageJob, jobId),
    onBulkJobProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: BulkMessageJobProgress) =>
        listener(progress);
      ipcRenderer.on(ACCOUNT_CHANNELS.bulkMessageJobChanged, handler);
      return () => ipcRenderer.removeListener(ACCOUNT_CHANNELS.bulkMessageJobChanged, handler);
    },
    sendReply: (accountId, draft) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.sendReply, accountId, draft),
    send: (accountId, draft) => ipcRenderer.invoke(ACCOUNT_CHANNELS.sendMessage, accountId, draft),
    suggestRecipients: (accountId, query) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.suggestRecipients, accountId, query),
    selectAttachments: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.selectAttachments),
    saveAttachment: (accountId, folderPath, uid, attachmentIndex) =>
      ipcRenderer.invoke(
        ACCOUNT_CHANNELS.saveAttachment,
        accountId,
        folderPath,
        uid,
        attachmentIndex,
      ),
    saveDraft: (accountId, draft, previous) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.saveDraft, accountId, draft, previous),
    deleteDraft: (accountId, draft) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.deleteDraft, accountId, draft),
  },
  sync: {
    status: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.syncStatus),
    now: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.syncNow),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: MailSyncStatus) => listener(status);
      ipcRenderer.on(ACCOUNT_CHANNELS.syncChanged, handler);
      return () => ipcRenderer.removeListener(ACCOUNT_CHANNELS.syncChanged, handler);
    },
  },
  providers: {
    list: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.providers),
    discover: (email) => ipcRenderer.invoke(ACCOUNT_CHANNELS.discoverProvider, email),
  },
} satisfies EmzeroDesktopApi);
