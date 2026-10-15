import {
  type AccountConnectionUpdate,
  type AccountDraft,
  type AccountOperationResult,
  type MailServerSettings,
} from '../shared/accounts.js';
import { verifyConnections } from './account-connection.js';
import {
  encryptAccountSecret,
  readAccounts,
  SECURE_STORAGE_UNAVAILABLE,
  toAccountSummary,
  writeAccounts,
} from './account-storage.js';
import { forgetAccountConnections, resolveMailSecret } from './mail-runtime.js';

function serverSettings(value: unknown): MailServerSettings | null {
  if (!value || typeof value !== 'object') return null;
  const server = value as Partial<MailServerSettings>;
  if (
    typeof server.host !== 'string' ||
    typeof server.port !== 'number' ||
    typeof server.secure !== 'boolean'
  ) {
    return null;
  }
  return { host: server.host.trim(), port: server.port, secure: server.secure };
}

function validConnectionUpdate(value: unknown): AccountConnectionUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const update = value as Partial<AccountConnectionUpdate>;
  const imap = serverSettings(update.imap);
  const smtp = serverSettings(update.smtp);
  if (typeof update.username !== 'string' || !imap || !smtp) return null;
  if (update.password !== undefined && typeof update.password !== 'string') return null;
  return { username: update.username.trim(), imap, smtp, password: update.password };
}

/**
 * Saves changed username, server, or password details for a password-authenticated
 * account after both IMAP and SMTP accept them. Without a new password the stored one
 * is used for the check.
 */
export async function updateAccountConnection(
  accountId: unknown,
  value: unknown,
): Promise<AccountOperationResult> {
  const update = validConnectionUpdate(value);
  if (typeof accountId !== 'string' || !update) {
    return { ok: false, message: 'Invalid account update.' };
  }
  const accounts = await readAccounts();
  const index = accounts.findIndex((candidate) => candidate.id === accountId);
  if (index < 0) return { ok: false, message: 'Account not found.' };
  const current = accounts[index];
  if (current.authentication !== 'password') {
    return { ok: false, message: 'Microsoft accounts use Microsoft sign-in and servers.' };
  }

  let password = update.password ?? '';
  if (!password) {
    try {
      password = await resolveMailSecret(current);
    } catch {
      return { ok: false, message: 'The stored password could not be read. Enter it again.' };
    }
  }
  const draft: AccountDraft = {
    name: current.name,
    email: current.email,
    username: update.username,
    credentials: { type: 'password', password },
    imap: update.imap,
    smtp: update.smtp,
  };
  const connectionResult = await verifyConnections(draft);
  if (!connectionResult.ok) return connectionResult;

  let encryptedSecret = current.encryptedSecret;
  if (update.password) {
    const encrypted = await encryptAccountSecret(update.password);
    if (!encrypted) return { ok: false, message: SECURE_STORAGE_UNAVAILABLE };
    encryptedSecret = encrypted;
  }

  // Re-read so a concurrent rename, color, or alias change is not overwritten.
  const latest = await readAccounts();
  const latestIndex = latest.findIndex((candidate) => candidate.id === accountId);
  if (latestIndex < 0) return { ok: false, message: 'Account not found.' };
  const account = {
    ...latest[latestIndex],
    username: update.username,
    imap: update.imap,
    smtp: update.smtp,
    encryptedSecret,
  };
  latest[latestIndex] = account;
  await writeAccounts(latest);
  forgetAccountConnections(accountId);
  return {
    ok: true,
    message: 'Connection details verified and saved.',
    account: toAccountSummary(account),
  };
}
