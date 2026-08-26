import { type FetchMessageObject, type FetchQueryObject, ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import type {
  MailAddressSummary,
  MailMessageDetail,
  MailMessageSummary,
  MessageDetailResult,
  MessageListResult,
} from '../shared/accounts.js';
import type { StoredAccount } from './account-storage.js';
import { hasQuotedHtml, sanitizedMessageHtml } from './message-html.js';
import {
  errorMessage,
  mailCache,
  withAccountImap,
} from './mail-runtime.js';

export function mailAddresses(
  value: Array<{ name?: string; address?: string }> | undefined,
): MailAddressSummary[] {
  return (value ?? []).map(({ name, address }) => ({
    name: name ?? null,
    address: address ?? null,
  }));
}

export function mailDateString(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function referenceIds(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (entry) => entry.match(/<[^>]+>/g) ?? entry.split(/\s+/).filter(Boolean),
  );
}

async function messageSummary(
  folderPath: string,
  message: FetchMessageObject,
): Promise<MailMessageSummary> {
  const parsedHeaders = message.headers
    ? await simpleParser(message.headers, { skipHtmlToText: true, skipTextToHtml: true })
    : null;
  return {
    folderPath,
    uid: message.uid,
    messageId: message.envelope?.messageId ?? null,
    inReplyTo: message.envelope?.inReplyTo ?? null,
    references: referenceIds(parsedHeaders?.references),
    subject: message.envelope?.subject?.trim() || '(No subject)',
    from: mailAddresses(message.envelope?.from),
    to: mailAddresses(message.envelope?.to),
    sentAt: mailDateString(message.envelope?.date),
    receivedAt: mailDateString(message.internalDate),
    unread: !message.flags?.has('\\Seen'),
    flagged: message.flags?.has('\\Flagged') ?? false,
    size: message.size ?? null,
  };
}

const summaryFetchQuery: FetchQueryObject = {
  uid: true,
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  headers: ['references'],
};

async function fetchSummaries(
  imap: ImapFlow,
  folderPath: string,
  range: string | number[],
  changedSince?: bigint,
): Promise<MailMessageSummary[]> {
  if (Array.isArray(range) && range.length === 0) return [];
  const messages: MailMessageSummary[] = [];
  for await (const message of imap.fetch(range, summaryFetchQuery, {
    uid: true,
    changedSince,
  })) {
    messages.push(await messageSummary(folderPath, message));
  }
  return messages;
}

const fullReconciliationInterval = 30 * 60_000;

export function shouldFullyReconcileFolder(
  syncedAt: string | null,
  now = Date.now(),
): boolean {
  if (!syncedAt) return true;
  const timestamp = Date.parse(syncedAt);
  return !Number.isFinite(timestamp) || now - timestamp >= fullReconciliationInterval;
}

export async function listFolderMessages(
  account: StoredAccount,
  folderPath: string,
  refresh = false,
): Promise<MessageListResult> {
  let password = '';
  const cached = mailCache().getFolderSyncState(account.id, folderPath);

  if (cached.syncedAt && !refresh) {
    return { ok: true, ...cached, source: 'cache' };
  }

  try {
    return await withAccountImap(account, async (imap, secret) => {
      password = secret;
      const lock = await imap.getMailboxLock(folderPath, { readOnly: true });
      try {
        if (!imap.mailbox) throw new Error('Mailbox did not open.');
        const mailbox = imap.mailbox;
        const uidValidity = mailbox.uidValidity.toString();
        const validityChanged =
          cached.uidValidity !== null && cached.uidValidity !== uidValidity;
        const reconcile =
          validityChanged ||
          cached.uidNext === null ||
          shouldFullyReconcileFolder(cached.syncedAt);
        const remoteUids = reconcile
          ? ((await imap.search({ all: true }, { uid: true })) || [])
          : [];
        const cachedUids = new Set(
          validityChanged ? [] : mailCache().listMessageUids(account.id, folderPath),
        );
        const summaries = new Map<number, MailMessageSummary>();

        if (
          !validityChanged &&
          cached.highestModseq &&
          mailbox.highestModseq &&
          mailbox.highestModseq > BigInt(cached.highestModseq)
        ) {
          for (const message of await fetchSummaries(
            imap,
            folderPath,
            '1:*',
            BigInt(cached.highestModseq),
          )) {
            summaries.set(message.uid, message);
          }
        }
        const nextUid = cached.uidNext ?? mailbox.uidNext;
        const newUidStart = Math.max(nextUid, mailbox.uidNext - 250);
        const newUids = Array.from(
          { length: Math.max(0, mailbox.uidNext - newUidStart) },
          (_, index) => newUidStart + index,
        );
        const requestedUids = reconcile
          ? [
              ...new Set([
                ...remoteUids.filter((uid) => !cachedUids.has(uid)).slice(-250),
                ...remoteUids.slice(-100),
              ]),
            ]
          : [
              ...new Set([
                ...newUids,
                ...(cached.highestModseq ? [] : [...cachedUids].slice(-100)),
              ]),
            ];
        for (const message of await fetchSummaries(imap, folderPath, requestedUids)) {
          summaries.set(message.uid, message);
        }

        mailCache().applyIncrementalSync(
          account.id,
          folderPath,
          [...summaries.values()],
          remoteUids,
          {
            uidValidity,
            uidNext: mailbox.uidNext,
            highestModseq: mailbox.highestModseq?.toString() ?? null,
            reconcile,
            messageCount: mailbox.exists,
          },
        );
        return { ok: true, ...mailCache().listMessages(account.id, folderPath), source: 'server' };
      } finally {
        lock.release();
      }
    });
  } catch (error) {
    if (cached.syncedAt) {
      return {
        ok: true,
        ...cached,
        source: 'cache',
        message: `Could not refresh messages. Showing saved data. ${errorMessage(error, password)}`,
      };
    }
    return {
      ok: false,
      messages: [],
      total: 0,
      message: `Could not load messages: ${errorMessage(error, password)}`,
    };
  }
}

export function parsedAddresses(
  value: AddressObject | AddressObject[] | undefined,
): MailAddressSummary[] {
  const entries = (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (addressObject) => addressObject.value,
  );
  return entries.flatMap((entry) => {
    if (entry.group) {
      return entry.group.map(({ name, address }) => ({
        name: name || null,
        address: address ?? null,
      }));
    }
    return [{ name: entry.name || null, address: entry.address ?? null }];
  });
}

export async function getFolderMessage(
  account: StoredAccount,
  folderPath: string,
  uid: number,
): Promise<MessageDetailResult> {
  const cachedBody = mailCache().getMessageBody(account.id, folderPath, uid);
  if (cachedBody) return { ok: true, messageDetail: cachedBody, source: 'cache' };

  let password = '';

  try {
    return await withAccountImap(
      account,
      async (imap, secret) => {
        password = secret;
        const lock = await imap.getMailboxLock(folderPath, { readOnly: true });
        try {
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
            sentAt: mailDateString(parsed.date),
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
          mailCache().putMessageBody(account.id, folderPath, messageDetail);
          return { ok: true, messageDetail, source: 'server' };
        } finally {
          lock.release();
        }
      },
      30_000,
    );
  } catch (error) {
    return {
      ok: false,
      message: `Could not load message: ${errorMessage(error, password)}`,
    };
  }
}
