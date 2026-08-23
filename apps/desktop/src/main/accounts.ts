import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, ipcMain, safeStorage } from 'electron';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import {
  ACCOUNT_CHANNELS,
  type AccountDraft,
  type AccountOperationResult,
  type AccountSummary,
  type FolderListResult,
  type MailAddressSummary,
  type MailFolderSummary,
  type MailMessageDetail,
  type MailMessageSummary,
  type MessageDetailResult,
  type MessageListResult,
  validateAccountDraft,
} from '../shared/accounts.js';
import { discoverProvider, listProviders } from './provider-discovery.js';
import { hasQuotedHtml, sanitizedMessageHtml } from './message-html.js';

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
  return password ? message.replaceAll(password, '••••••••') : message;
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

async function decryptPassword(account: StoredAccount): Promise<string> {
  const encrypted = Buffer.from(account.encryptedPassword, 'base64');
  const { result } = await safeStorage.decryptStringAsync(encrypted);
  return result;
}

async function listAccountFolders(account: StoredAccount): Promise<FolderListResult> {
  let password = '';
  let imap: ImapFlow | null = null;

  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 15_000,
    });
    await imap.connect();
    const folders: MailFolderSummary[] = (await imap.list()).map((folder) => ({
      path: folder.path,
      name: folder.name,
      parentPath: folder.parentPath,
      delimiter: folder.delimiter,
      specialUse: folder.specialUse ?? null,
      selectable: !folder.flags.has('\\Noselect'),
    }));
    return { ok: true, folders };
  } catch (error) {
    return {
      ok: false,
      folders: [],
      message: `Could not load folders: ${errorMessage(error, password)}`,
    };
  } finally {
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

function addresses(
  value: Array<{ name?: string; address?: string }> | undefined,
): MailAddressSummary[] {
  return (value ?? []).map(({ name, address }) => ({
    name: name ?? null,
    address: address ?? null,
  }));
}

function dateString(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function referenceIds(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (entry) => entry.match(/<[^>]+>/g) ?? entry.split(/\s+/).filter(Boolean),
  );
}

async function listFolderMessages(
  account: StoredAccount,
  folderPath: string,
): Promise<MessageListResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;

  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 20_000,
    });
    await imap.connect();
    lock = await imap.getMailboxLock(folderPath, { readOnly: true });

    const total = imap.mailbox ? imap.mailbox.exists : 0;
    if (total === 0) return { ok: true, messages: [], total: 0 };

    const start = Math.max(1, total - 49);
    const messages: MailMessageSummary[] = [];
    for await (const message of imap.fetch(`${start}:*`, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      headers: ['references'],
    })) {
      const parsedHeaders = message.headers
        ? await simpleParser(message.headers, { skipHtmlToText: true, skipTextToHtml: true })
        : null;
      messages.push({
        folderPath,
        uid: message.uid,
        messageId: message.envelope?.messageId ?? null,
        inReplyTo: message.envelope?.inReplyTo ?? null,
        references: referenceIds(parsedHeaders?.references),
        subject: message.envelope?.subject?.trim() || '(No subject)',
        from: addresses(message.envelope?.from),
        to: addresses(message.envelope?.to),
        sentAt: dateString(message.envelope?.date),
        receivedAt: dateString(message.internalDate),
        unread: !message.flags?.has('\\Seen'),
        flagged: message.flags?.has('\\Flagged') ?? false,
        size: message.size ?? null,
      });
    }

    messages.reverse();
    return { ok: true, messages, total };
  } catch (error) {
    return {
      ok: false,
      messages: [],
      total: 0,
      message: `Could not load messages: ${errorMessage(error, password)}`,
    };
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
}

function parsedAddresses(value: AddressObject | AddressObject[] | undefined): MailAddressSummary[] {
  const entries = (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (addressObject) => addressObject.value,
  );
  return entries.flatMap((entry) => {
    if (entry.group) {
      return entry.group.map(({ name, address }) => ({ name: name || null, address: address ?? null }));
    }
    return [{ name: entry.name || null, address: entry.address ?? null }];
  });
}

async function getFolderMessage(
  account: StoredAccount,
  folderPath: string,
  uid: number,
): Promise<MessageDetailResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;

  try {
    password = await decryptPassword(account);
    imap = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 30_000,
    });
    await imap.connect();
    lock = await imap.getMailboxLock(folderPath, { readOnly: true });

    const fetched = await imap.fetchOne(uid, { source: true }, { uid: true });
    if (!fetched || !fetched.source) {
      return { ok: false, message: 'This message is no longer available.' };
    }

    const parsed = await simpleParser(fetched.source);
    const messageDetail: MailMessageDetail = {
      uid,
      messageId: parsed.messageId ?? null,
      subject: parsed.subject?.trim() || '(No subject)',
      from: parsedAddresses(parsed.from),
      to: parsedAddresses(parsed.to),
      cc: parsedAddresses(parsed.cc),
      replyTo: parsedAddresses(parsed.replyTo),
      sentAt: dateString(parsed.date),
      text: parsed.text?.trim() || 'This message has no readable text content.',
      html: sanitizedMessageHtml(parsed.html),
      htmlHasQuotedText: hasQuotedHtml(parsed.html),
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename || 'Unnamed attachment',
        contentType: attachment.contentType,
        size: attachment.size,
        related: attachment.related,
      })),
    };
    return { ok: true, messageDetail };
  } catch (error) {
    return {
      ok: false,
      message: `Could not load message: ${errorMessage(error, password)}`,
    };
  } finally {
    lock?.release();
    if (imap?.usable) await imap.logout().catch(() => imap?.close());
    else imap?.close();
  }
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

  ipcMain.handle(ACCOUNT_CHANNELS.listFolders, async (event, accountId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (typeof accountId !== 'string') {
      return { ok: false, folders: [], message: 'Invalid account.' } satisfies FolderListResult;
    }
    const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
    if (!account) {
      return { ok: false, folders: [], message: 'Account not found.' } satisfies FolderListResult;
    }
    return listAccountFolders(account);
  });

  ipcMain.handle(
    ACCOUNT_CHANNELS.listMessages,
    async (event, accountId: unknown, folderPath: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (typeof accountId !== 'string' || typeof folderPath !== 'string' || !folderPath) {
        return {
          ok: false,
          messages: [],
          total: 0,
          message: 'Invalid mailbox.',
        } satisfies MessageListResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) {
        return {
          ok: false,
          messages: [],
          total: 0,
          message: 'Account not found.',
        } satisfies MessageListResult;
      }
      return listFolderMessages(account, folderPath);
    },
  );

  ipcMain.handle(
    ACCOUNT_CHANNELS.getMessage,
    async (event, accountId: unknown, folderPath: unknown, uid: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      if (
        typeof accountId !== 'string' ||
        typeof folderPath !== 'string' ||
        !folderPath ||
        typeof uid !== 'number' ||
        !Number.isInteger(uid) ||
        uid < 1
      ) {
        return { ok: false, message: 'Invalid message.' } satisfies MessageDetailResult;
      }
      const account = (await readAccounts()).find((candidate) => candidate.id === accountId);
      if (!account) {
        return { ok: false, message: 'Account not found.' } satisfies MessageDetailResult;
      }
      return getFolderMessage(account, folderPath, uid);
    },
  );

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
