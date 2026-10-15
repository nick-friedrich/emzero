import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { withAccountColors, type AccountSummary } from '../shared/accounts.js';
import { storedAliases } from '../shared/aliases.js';

export interface StoredAccount extends AccountSummary {
  encryptedSecret: string;
  oauthClientId?: string;
}

const accountsPath = () => path.join(app.getPath('userData'), 'accounts.json');

export async function readAccounts(): Promise<StoredAccount[]> {
  try {
    const value: unknown = JSON.parse(await readFile(accountsPath(), 'utf8'));
    if (!Array.isArray(value)) return [];
    return withAccountColors(value.map((entry) => {
      const account = entry as StoredAccount & { encryptedPassword?: string };
      return {
        id: account.id,
        name: account.name,
        email: account.email,
        username: account.username,
        imap: account.imap,
        smtp: account.smtp,
        authentication:
          account.authentication === 'microsoft-oauth' ? 'microsoft-oauth' : 'password',
        createdAt: account.createdAt,
        color: account.color,
        aliases: storedAliases(account.aliases, account.email),
        encryptedSecret: account.encryptedSecret ?? account.encryptedPassword ?? '',
        ...(account.oauthClientId ? { oauthClientId: account.oauthClientId } : {}),
      };
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeAccounts(accounts: StoredAccount[]): Promise<void> {
  const target = accountsPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

/** Encrypts an account secret, or returns null when no secure system keyring is available. */
export async function encryptAccountSecret(secret: string): Promise<string | null> {
  const insecureLinuxBackend =
    process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
  const asyncEncryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
  if (!safeStorage.isEncryptionAvailable() || !asyncEncryptionAvailable || insecureLinuxBackend) {
    return null;
  }
  return (await safeStorage.encryptStringAsync(secret)).toString('base64');
}

export const SECURE_STORAGE_UNAVAILABLE =
  'Secure credential storage is unavailable. Unlock or configure your system keyring and try again.';

export function toAccountSummary(account: StoredAccount): AccountSummary {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    username: account.username,
    imap: account.imap,
    smtp: account.smtp,
    authentication: account.authentication,
    createdAt: account.createdAt,
    color: account.color,
    aliases: account.aliases,
  };
}
