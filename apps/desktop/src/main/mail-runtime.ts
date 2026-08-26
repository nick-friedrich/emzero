import path from 'node:path';
import { app, safeStorage } from 'electron';
import { ImapFlow } from 'imapflow';
import { readAccounts, writeAccounts, type StoredAccount } from './account-storage.js';
import { MailCache } from './mail-cache.js';
import { refreshMicrosoftAccessToken } from './microsoft-oauth.js';

let cache: MailCache | null = null;

interface PooledImapConnection {
  imap: ImapFlow | null;
  queue: Promise<void>;
  idleTimer: NodeJS.Timeout | null;
}

export type ImapConnectionLane = 'interactive' | 'background' | 'prefetch';

const pooledImapConnections = new Map<string, PooledImapConnection>();
const passwordCache = new Map<string, string>();

export function mailCache(): MailCache {
  cache ??= new MailCache(path.join(app.getPath('userData'), 'mail-cache.sqlite'));
  return cache;
}

export function closeMailCache(): void {
  for (const connection of pooledImapConnections.values()) {
    if (connection.idleTimer) clearTimeout(connection.idleTimer);
    connection.imap?.close();
  }
  pooledImapConnections.clear();
  passwordCache.clear();
  cache?.close();
  cache = null;
}

export function errorMessage(error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : 'Unknown connection error';
  return secret ? message.replaceAll(secret, '••••••••') : message;
}

async function decryptAccountSecret(account: StoredAccount): Promise<string> {
  const encrypted = Buffer.from(account.encryptedSecret, 'base64');
  const { result } = await safeStorage.decryptStringAsync(encrypted);
  return result;
}

const microsoftTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
const microsoftTokenRequests = new Map<string, Promise<string>>();

async function refreshAccountMicrosoftToken(account: StoredAccount): Promise<string> {
  if (!account.oauthClientId) throw new Error('This account is missing its Microsoft client ID.');
  const refreshToken = await decryptAccountSecret(account);
  const tokens = await refreshMicrosoftAccessToken(account.oauthClientId, refreshToken);
  microsoftTokenCache.set(account.id, {
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresIn * 1_000,
  });
  if (tokens.refreshToken !== refreshToken) {
    const accounts = await readAccounts();
    const index = accounts.findIndex((candidate) => candidate.id === account.id);
    if (index >= 0 && accounts[index].authentication === 'microsoft-oauth') {
      accounts[index] = {
        ...accounts[index],
        encryptedSecret: (await safeStorage.encryptStringAsync(tokens.refreshToken)).toString(
          'base64',
        ),
      };
      await writeAccounts(accounts);
    }
  }
  return tokens.accessToken;
}

export async function resolveMailSecret(account: StoredAccount): Promise<string> {
  if (account.authentication === 'password') {
    const cachedPassword = passwordCache.get(account.id);
    if (cachedPassword) return cachedPassword;
    const password = await decryptAccountSecret(account);
    passwordCache.set(account.id, password);
    return password;
  }
  const cached = microsoftTokenCache.get(account.id);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.accessToken;
  const active = microsoftTokenRequests.get(account.id);
  if (active) return active;
  const request = refreshAccountMicrosoftToken(account).finally(() => {
    microsoftTokenRequests.delete(account.id);
  });
  microsoftTokenRequests.set(account.id, request);
  return request;
}

export async function withAccountImap<T>(
  account: StoredAccount,
  operation: (imap: ImapFlow, secret: string) => Promise<T>,
  socketTimeout = 20_000,
  lane: ImapConnectionLane = 'interactive',
): Promise<T> {
  // Periodic synchronization can hold a mailbox lock while Gmail searches a
  // large mailbox. Keep clicks and bounded speculative reads on separate
  // connections so neither waits behind that background work.
  const connectionKey = `${account.id}:${lane}`;
  const connection = pooledImapConnections.get(connectionKey) ?? {
    imap: null,
    queue: Promise.resolve(),
    idleTimer: null,
  };
  pooledImapConnections.set(connectionKey, connection);

  let releaseQueue!: () => void;
  const previous = connection.queue;
  connection.queue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  if (connection.idleTimer) {
    clearTimeout(connection.idleTimer);
    connection.idleTimer = null;
  }

  try {
    const secret = await resolveMailSecret(account);
    if (!connection.imap?.usable) {
      connection.imap?.close();
      connection.imap = createImapClient(account, secret, socketTimeout);
      await connection.imap.connect();
    }
    return await operation(connection.imap, secret);
  } catch (error) {
    if (connection.imap && !connection.imap.usable) {
      connection.imap.close();
      connection.imap = null;
    }
    throw error;
  } finally {
    releaseQueue();
    connection.idleTimer = setTimeout(() => {
      connection.imap?.close();
      connection.imap = null;
      connection.idleTimer = null;
    }, 2 * 60_000);
  }
}

export function smtpAuthentication(account: StoredAccount, secret: string) {
  return account.authentication === 'microsoft-oauth'
    ? { type: 'OAuth2' as const, user: account.username, accessToken: secret }
    : { user: account.username, pass: secret };
}

export function createImapClient(
  account: StoredAccount,
  secret: string,
  socketTimeout = 20_000,
): ImapFlow {
  return new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth:
      account.authentication === 'microsoft-oauth'
        ? { user: account.username, accessToken: secret }
        : { user: account.username, pass: secret },
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
