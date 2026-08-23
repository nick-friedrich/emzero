import { contextBridge, ipcRenderer } from 'electron';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountOperationResult,
  type AccountSummary,
  type FolderListResult,
  type MessageListResult,
  type MailProvider,
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
    list: (accountId: string) => Promise<FolderListResult>;
  };
  messages: {
    list: (accountId: string, folderPath: string) => Promise<MessageListResult>;
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
    list: (accountId) => ipcRenderer.invoke(ACCOUNT_CHANNELS.listFolders, accountId),
  },
  messages: {
    list: (accountId, folderPath) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.listMessages, accountId, folderPath),
  },
  providers: {
    list: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.providers),
    discover: (email) => ipcRenderer.invoke(ACCOUNT_CHANNELS.discoverProvider, email),
  },
} satisfies EmzeroDesktopApi);
