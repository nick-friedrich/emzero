import { contextBridge, ipcRenderer } from 'electron';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountOperationResult,
  type AccountSummary,
  type FolderListResult,
  type MessageListResult,
  type MessageDetailResult,
  type MailProvider,
  type MailSyncStatus,
  type ProviderDiscoveryResult,
} from '../shared/accounts.js';

export interface EmzeroDesktopApi {
  platform: NodeJS.Platform;
  accounts: {
    list: () => Promise<AccountSummary[]>;
    test: (draft: AccountDraft) => Promise<AccountOperationResult>;
    save: (draft: AccountDraft) => Promise<AccountOperationResult>;
  };
  folders: {
    list: (accountId: string, refresh?: boolean) => Promise<FolderListResult>;
  };
  messages: {
    list: (accountId: string, folderPath: string, refresh?: boolean) => Promise<MessageListResult>;
    get: (accountId: string, folderPath: string, uid: number) => Promise<MessageDetailResult>;
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
  },
  folders: {
    list: (accountId, refresh = false) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.listFolders, accountId, refresh),
  },
  messages: {
    list: (accountId, folderPath, refresh = false) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.listMessages, accountId, folderPath, refresh),
    get: (accountId, folderPath, uid) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.getMessage, accountId, folderPath, uid),
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
