import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, ipcMain, safeStorage } from 'electron';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountOperationResult,
  type AccountSummary,
  validateAccountDraft,
} from '../shared/accounts.js';
import { discoverProvider, listProviders } from './provider-discovery.js';

interface StoredAccount extends AccountSummary {
  encryptedPassword: string;
}

const accountsPath = () => path.join(app.getPath('userData'), 'accounts.json');

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
  return message.replaceAll(password, '••••••••');
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

function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) return false;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return senderUrl.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  }
  return senderUrl.startsWith('file://');
}

export function registerAccountHandlers(): void {
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
    return {
      ok: true,
      message: 'Account connected and saved securely.',
      account: toSummary(account),
    } satisfies AccountOperationResult;
  });
}
