import path from 'node:path';
import { app, safeStorage } from 'electron';
import { ImapFlow } from 'imapflow';
import type { StoredAccount } from './account-storage.js';
import { MailCache } from './mail-cache.js';

let cache: MailCache | null = null;

export function mailCache(): MailCache {
  cache ??= new MailCache(path.join(app.getPath('userData'), 'mail-cache.sqlite'));
  return cache;
}

export function closeMailCache(): void {
  cache?.close();
  cache = null;
}

export function errorMessage(error: unknown, password: string): string {
  const message = error instanceof Error ? error.message : 'Unknown connection error';
  return password ? message.replaceAll(password, '••••••••') : message;
}

export async function decryptPassword(account: StoredAccount): Promise<string> {
  const encrypted = Buffer.from(account.encryptedPassword, 'base64');
  const { result } = await safeStorage.decryptStringAsync(encrypted);
  return result;
}

export function createImapClient(
  account: StoredAccount,
  password: string,
  socketTimeout = 20_000,
): ImapFlow {
  return new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: { user: account.username, pass: password },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout,
  });
}

export async function closeImap(imap: ImapFlow | null): Promise<void> {
  if (imap?.usable) await imap.logout().catch(() => imap.close());
  else imap?.close();
}
