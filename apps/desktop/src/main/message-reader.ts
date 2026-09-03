import { type FetchMessageObject, type FetchQueryObject, ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
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
  type ImapConnectionLane,
  mailCache,
  withAccountImap,
} from './mail-runtime.js';
import {
  emzeroColorFromFlags,
  emzeroImportanceFromFlags,
  supportsEmzeroKeywords,
} from '../shared/message-keywords.js';

export function mailAddresses(
  value: Array<{ name?: string; address?: string }> | undefined,
  senderAvatarUrl: string | null = null,
): MailAddressSummary[] {
  return (value ?? []).map(({ name, address }, index) => ({
    name: name ?? null,
    address: address ?? null,
    ...(index === 0 && senderAvatarUrl ? { avatarUrl: senderAvatarUrl } : {}),
  }));
}

export function faceHeaderAvatar(value: unknown): string | null {
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== 'string') return null;
  const encoded = header.replace(/\s+/g, '');
  if (!encoded || encoded.length > 140_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null;
  }
  const image = Buffer.from(encoded, 'base64');
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const hasPngHeader =
    image.length >= 24 &&
    image.subarray(0, 8).equals(pngSignature) &&
    image.subarray(12, 16).toString('ascii') === 'IHDR';
  const width = hasPngHeader ? image.readUInt32BE(16) : 0;
  const height = hasPngHeader ? image.readUInt32BE(20) : 0;
  if (
    image.length > 100_000 ||
    !hasPngHeader ||
    width === 0 ||
    height === 0 ||
    width > 256 ||
    height > 256
  ) {
    return null;
  }
  return `data:image/png;base64,${encoded}`;
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

function parsedMessageDetail(uid: number, parsed: ParsedMail): MailMessageDetail {
  return {
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
}

async function messageSummary(
  folderPath: string,
  message: FetchMessageObject,
): Promise<MailMessageSummary> {
  const parsedHeaders = message.headers
    ? await simpleParser(message.headers, {
        skipHtmlToText: true,
        skipTextToHtml: true,
      })
    : null;
  const senderAvatarUrl = faceHeaderAvatar(parsedHeaders?.headers.get('face'));
  const importance = emzeroImportanceFromFlags(message.flags);
  return {
    folderPath,
    uid: message.uid,
    messageId: message.envelope?.messageId ?? null,
    inReplyTo: message.envelope?.inReplyTo ?? null,
    references: referenceIds(parsedHeaders?.references),
    subject: message.envelope?.subject?.trim() || '(No subject)',
    from: mailAddresses(message.envelope?.from, senderAvatarUrl),
    to: mailAddresses(message.envelope?.to),
    sentAt: mailDateString(message.envelope?.date),
    receivedAt: mailDateString(message.internalDate),
    unread: !message.flags?.has('\\Seen'),
    flagged: message.flags?.has('\\Flagged') ?? false,
    ...importance,
    color: emzeroColorFromFlags(message.flags),
    size: message.size ?? null,
  };
}

const summaryFetchQuery: FetchQueryObject = {
  uid: true,
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  headers: ['references', 'face'],
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

export function shouldFullyReconcileFolder(syncedAt: string | null, now = Date.now()): boolean {
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

  if (cached.syncedAt && cached.supportsEmzeroKeywords !== undefined && !refresh) {
    return { ok: true, ...cached, source: 'cache' };
  }

  try {
    return await withAccountImap(
      account,
      async (imap, secret) => {
        password = secret;
        const lock = await imap.getMailboxLock(folderPath, { readOnly: true });
        try {
          if (!imap.mailbox) throw new Error('Mailbox did not open.');
          const mailbox = imap.mailbox;
          const keywordSupport = supportsEmzeroKeywords(mailbox.permanentFlags);
          const uidValidity = mailbox.uidValidity.toString();
          const validityChanged = cached.uidValidity !== null && cached.uidValidity !== uidValidity;
          const reconcile =
            validityChanged ||
            cached.uidNext === null ||
            shouldFullyReconcileFolder(cached.syncedAt);
          const remoteUids = reconcile
            ? (await imap.search({ all: true }, { uid: true })) || []
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
              supportsEmzeroKeywords: keywordSupport,
            },
          );
          return {
            ok: true,
            ...mailCache().listMessages(account.id, folderPath),
            source: 'server',
          };
        } finally {
          lock.release();
        }
      },
      20_000,
      'background',
    );
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

const activeMessageRequests = new Map<string, Promise<MessageDetailResult>>();

export function getFolderMessage(
  account: StoredAccount,
  folderPath: string,
  uid: number,
  lane: ImapConnectionLane = 'interactive',
): Promise<MessageDetailResult> {
  const cachedBody = mailCache().getMessageBody(account.id, folderPath, uid);
  if (cachedBody) {
    return Promise.resolve({ ok: true, messageDetail: cachedBody, source: 'cache' });
  }

  const requestKey = `${account.id}\u0000${folderPath}\u0000${uid}`;
  const activeRequest = activeMessageRequests.get(requestKey);
  if (activeRequest) return activeRequest;

  const request = fetchFolderMessage(account, folderPath, uid, lane).finally(() => {
    if (activeMessageRequests.get(requestKey) === request) {
      activeMessageRequests.delete(requestKey);
    }
  });
  activeMessageRequests.set(requestKey, request);
  return request;
}

async function fetchFolderMessage(
  account: StoredAccount,
  folderPath: string,
  uid: number,
  lane: ImapConnectionLane,
): Promise<MessageDetailResult> {

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
            mailCache().deleteMessages(account.id, folderPath, [uid]);
            mailCache().invalidateFolder(account.id, folderPath);
            return {
              ok: false,
              message: 'This message is no longer available.',
            };
          }
          const messageDetail = parsedMessageDetail(
            uid,
            await simpleParser(fetched.source),
          );
          mailCache().putMessageBody(account.id, folderPath, messageDetail);
          return { ok: true, messageDetail, source: 'server' };
        } finally {
          lock.release();
        }
      },
      30_000,
      lane,
    );
  } catch (error) {
    return {
      ok: false,
      message: `Could not load message: ${errorMessage(error, password)}`,
    };
  }
}
