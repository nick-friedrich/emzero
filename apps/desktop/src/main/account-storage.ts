import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { AccountSummary } from '../shared/accounts.js';

export interface StoredAccount extends AccountSummary {
  encryptedSecret: string;
  oauthClientId?: string;
}

const accountsPath = () => path.join(app.getPath('userData'), 'accounts.json');

export async function readAccounts(): Promise<StoredAccount[]> {
  try {
    const value: unknown = JSON.parse(await readFile(accountsPath(), 'utf8'));
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
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
        encryptedSecret: account.encryptedSecret ?? account.encryptedPassword ?? '',
        ...(account.oauthClientId ? { oauthClientId: account.oauthClientId } : {}),
      };
    });
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
  };
}
