import {
  type FetchMessageObject,
  type FetchQueryObject,
  ImapFlow,
  type MessageStructureObject,
} from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import type {
  MailAddressSummary,
  MailAttachmentSummary,
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

interface MessageTextPart {
  part: string;
  type: 'text/plain' | 'text/html';
  charset?: string;
}

export function messageTextParts(structure: MessageStructureObject): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  const visit = (node: MessageStructureObject, isRoot = false): void => {
    const type = node.type.toLowerCase();
    if (type === 'message/rfc822') return;
    for (const child of node.childNodes ?? []) visit(child);
    const part = node.part ?? (isRoot && !node.childNodes?.length ? '1' : undefined);
    const hasFilename = Boolean(
      node.dispositionParameters?.filename || node.parameters?.name,
    );
    if (
      part &&
      (type === 'text/plain' || type === 'text/html') &&
      node.disposition?.toLowerCase() !== 'attachment' &&
      !hasFilename
    ) {
      parts.push({ part, type, charset: node.parameters?.charset });
    }
  };
  visit(structure, true);
  return parts;
}

export function messageAttachmentSummaries(
  structure: MessageStructureObject,
): MailAttachmentSummary[] {
  const attachments: MailAttachmentSummary[] = [];
  const visit = (
    node: MessageStructureObject,
    insideRelated: boolean,
    isRoot = false,
  ): void => {
    const type = node.type.toLowerCase();
    const related = insideRelated || type === 'multipart/related';
    if (type === 'message/rfc822' && node.part) {
      attachments.push({
        filename:
          node.dispositionParameters?.filename ||
          node.parameters?.name ||
          'Forwarded message.eml',
        contentType: type,
        size: node.size ?? 0,
        related,
      });
      return;
    }
    for (const child of node.childNodes ?? []) visit(child, related);
    const part = node.part ?? (isRoot && !node.childNodes?.length ? '1' : undefined);
    if (!part || node.childNodes?.length) return;
    const filename =
      node.dispositionParameters?.filename || node.parameters?.name || 'Unnamed attachment';
    const isBodyText =
      (type === 'text/plain' || type === 'text/html') &&
      node.disposition?.toLowerCase() !== 'attachment' &&
      filename === 'Unnamed attachment';
    if (isBodyText) return;
    attachments.push({
      filename,
      contentType: type,
      size: node.size ?? 0,
      related: related || node.disposition?.toLowerCase() === 'inline' || Boolean(node.id),
    });
  };
  visit(structure, false, true);
  return attachments;
}

function decodedText(content: Buffer | null, charset = 'utf-8'): string {
  if (!content) return '';
  try {
    return new TextDecoder(charset).decode(content).trim();
  } catch {
    return new TextDecoder().decode(content).trim();
  }
}

async function downloadedText(
  imap: ImapFlow,
  uid: number,
  part: MessageTextPart,
): Promise<string> {
  const downloaded = await imap.download(uid, part.part, {
    uid: true,
    maxBytes: 5 * 1024 * 1024,
  });
  const chunks: Buffer[] = [];
  for await (const chunk of downloaded.content) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return decodedText(Buffer.concat(chunks), downloaded.meta.charset ?? part.charset);
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

  if (cached.syncedAt && !refresh) {
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
          const fetched = await imap.fetchOne(
            uid,
            { headers: true, bodyStructure: true },
            { uid: true },
          );
          if (!fetched || !fetched.headers || !fetched.bodyStructure) {
            return {
              ok: false,
              message: 'This message is no longer available.',
            };
          }

          const parsed = await simpleParser(fetched.headers, {
            skipHtmlToText: true,
            skipTextToHtml: true,
          });
          const textParts = messageTextParts(fetched.bodyStructure);
          const downloadedParts = new Map<string, string>();
          if (!fetched.bodyStructure.childNodes?.length && textParts[0]) {
            downloadedParts.set(
              textParts[0].part,
              await downloadedText(imap, uid, textParts[0]),
            );
          } else if (textParts.length) {
            const downloads = await imap.downloadMany(
              uid,
              [...new Set(textParts.map(({ part }) => part))],
              { uid: true },
            );
            for (const part of textParts) {
              downloadedParts.set(
                part.part,
                decodedText(
                  downloads[part.part]?.content ?? null,
                  downloads[part.part]?.meta.charset ?? part.charset,
                ),
              );
            }
          }
          const plainText = textParts
            .filter(({ type }) => type === 'text/plain')
            .map(({ part }) => downloadedParts.get(part) ?? '')
            .find(Boolean);
          const html = textParts
            .filter(({ type }) => type === 'text/html')
            .map(({ part }) => downloadedParts.get(part) ?? '')
            .find(Boolean);
          const messageDetail: MailMessageDetail = {
            uid,
            messageId: parsed.messageId ?? null,
            subject: parsed.subject?.trim() || '(No subject)',
            from: parsedAddresses(parsed.from),
            to: parsedAddresses(parsed.to),
            cc: parsedAddresses(parsed.cc),
            replyTo: parsedAddresses(parsed.replyTo),
            sentAt: mailDateString(parsed.date),
            text: plainText || 'This message has no readable text content.',
            html: sanitizedMessageHtml(html || false),
            htmlHasQuotedText: hasQuotedHtml(html || false),
            attachments: messageAttachmentSummaries(fetched.bodyStructure),
          };
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
