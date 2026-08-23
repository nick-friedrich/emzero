import { contextBridge, ipcRenderer } from 'electron';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountOperationResult,
  type AccountSummary,
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
  providers: {
    list: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.providers),
    discover: (email) => ipcRenderer.invoke(ACCOUNT_CHANNELS.discoverProvider, email),
  },
} satisfies EmzeroDesktopApi);
