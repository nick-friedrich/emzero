import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import {
  ACCOUNT_CHANNELS,
  findInboxFolder,
  type MailAddressSummary,
  type MailDraftReference,
  type MailDraftSaveResult,
  type MailFolderSummary,
  type MailMessageDetail,
  type MailMessageSummary,
  type MailSendDraft,
  type MailSendResult,
} from '../shared/accounts.js';
import { accountAddresses } from '../shared/aliases.js';
import type { FolderChange } from './account-folders.js';
import type { StoredAccount } from './account-storage.js';
import { readAccounts } from './account-storage.js';
import { releaseOutgoingAttachments } from './attachment-files.js';
import { mailCache } from './mail-runtime.js';
import { hasQuotedHtml, sanitizedMessageHtml } from './message-html.js';
import { outgoingHtml } from './outgoing-html.js';

// In demo mode the local mail cache is the mail server: every operation that would talk to
// IMAP or SMTP applies its result to the cache directly, exactly as a later sync would.

export interface DemoMessage {
  summary: Omit<MailMessageSummary, 'folderPath' | 'uid' | 'preview' | 'insights'>;
  detail: Omit<MailMessageDetail, 'uid'>;
}

// UIDs only grow, like IMAP's UIDNEXT, so cached bodies never attach to a later message.
function nextUid(accountId: string, folderPath: string): number {
  return Math.max(
    mailCache().getFolderSyncState(accountId, folderPath).uidNext ?? 1,
    ...mailCache().listMessageUids(accountId, folderPath).map((uid) => uid + 1),
  );
}

/** Adds messages to a demo folder with fresh UIDs, keeping its counts current. */
export function storeDemoMessages(
  accountId: string,
  folderPath: string,
  messages: DemoMessage[],
): MailMessageSummary[] {
  const cache = mailCache();
  let uid = nextUid(accountId, folderPath);
  const stored = messages.map(({ summary }): MailMessageSummary => ({ ...summary, folderPath, uid: uid++ }));
  cache.applyIncrementalSync(
    accountId,
    folderPath,
    stored,
    [...cache.listMessageUids(accountId, folderPath), ...stored.map((message) => message.uid)],
    { uidValidity: 'demo', uidNext: uid, highestModseq: null, supportsEmzeroKeywords: true },
  );
  stored.forEach((message, index) => {
    cache.putMessageBody(accountId, folderPath, { ...messages[index].detail, uid: message.uid });
  });
  cache.refreshUnreadCount(accountId, folderPath);
  return stored;
}

function storedDemoMessages(accountId: string, folderPath: string, uids: number[]): DemoMessage[] {
  const cache = mailCache();
  const wanted = new Set(uids);
  return cache.listMessages(accountId, folderPath).messages
    .filter((message) => wanted.has(message.uid))
    .map((summary) => ({
      // The cache ignores the location, preview, and insights a listed summary carries.
      summary,
      detail: cache.getMessageBody(accountId, folderPath, summary.uid) ?? {
        messageId: summary.messageId,
        subject: summary.subject,
        from: summary.from,
        to: summary.to,
        cc: [],
        replyTo: [],
        sentAt: summary.sentAt,
        text: '',
        html: null,
        htmlHasQuotedText: false,
        attachments: [],
      },
    }));
}

export function moveDemoMessages(
  sourceAccountId: string,
  sourcePath: string,
  uids: number[],
  destinationAccountId: string,
  destinationPath: string,
): void {
  const messages = storedDemoMessages(sourceAccountId, sourcePath, uids);
  mailCache().deleteMessages(sourceAccountId, sourcePath, uids);
  storeDemoMessages(destinationAccountId, destinationPath, messages);
}

/** Moves messages to Trash, or removes them for good when they are already there. */
export function deleteDemoMessages(accountId: string, folderPath: string, uids: number[]): void {
  const trash = mailCache()
    .listFolders(accountId)
    .find((folder) => folder.selectable && folder.specialUse === '\\Trash');
  if (trash && trash.path !== folderPath) moveDemoMessages(accountId, folderPath, uids, accountId, trash.path);
  else mailCache().deleteMessages(accountId, folderPath, uids);
}

function folderPathsUnder(folders: MailFolderSummary[], path: string): MailFolderSummary[] {
  return folders.filter(
    (folder) => folder.path === path || folder.path.startsWith(`${path}${folder.delimiter}`),
  );
}

export function applyDemoFolderChange(accountId: string, change: FolderChange): MailFolderSummary[] {
  const cache = mailCache();
  const folders = cache.listFolders(accountId);
  if (change.kind === 'create') {
    const delimiter = folders[0]?.delimiter ?? '/';
    const separator = change.path.lastIndexOf(delimiter);
    cache.replaceFolders(accountId, [...folders, {
      path: change.path,
      name: change.path.slice(separator + 1),
      parentPath: separator < 0 ? '' : change.path.slice(0, separator),
      delimiter,
      specialUse: null,
      selectable: true,
      unreadCount: 0,
      totalCount: 0,
    }]);
    storeDemoMessages(accountId, change.path, []);
  } else if (change.kind === 'rename') {
    const affected = folderPathsUnder(folders, change.from);
    const renamed = (path: string) => `${change.to}${path.slice(change.from.length)}`;
    const nextFolders = folders.map((folder) => {
      if (!affected.includes(folder)) return folder;
      const path = renamed(folder.path);
      return {
        ...folder,
        path,
        name: path.slice(path.lastIndexOf(folder.delimiter) + 1),
        parentPath: folder.path === change.from
          ? path.slice(0, Math.max(0, path.lastIndexOf(folder.delimiter)))
          : renamed(folder.parentPath),
      };
    });
    cache.replaceFolders(accountId, [...folders, ...nextFolders.filter((folder) => !folders.includes(folder))]);
    for (const folder of affected) {
      storeDemoMessages(accountId, renamed(folder.path), []);
      const uids = cache.listMessageUids(accountId, folder.path);
      if (uids.length > 0) moveDemoMessages(accountId, folder.path, uids, accountId, renamed(folder.path));
    }
    cache.replaceFolders(accountId, cache.listFolders(accountId).filter(
      (folder) => !affected.some((old) => old.path === folder.path),
    ));
  } else {
    const removed = folderPathsUnder(folders, change.path);
    for (const folder of removed) {
      cache.deleteMessages(accountId, folder.path, cache.listMessageUids(accountId, folder.path));
    }
    cache.replaceFolders(accountId, folders.filter((folder) => !removed.includes(folder)));
  }
  return cache.listFolders(accountId);
}

function specialFolder(accountId: string, specialUse: string): MailFolderSummary | undefined {
  return mailCache()
    .listFolders(accountId)
    .find((folder) => folder.selectable && folder.specialUse === specialUse);
}

function composedDemoMessage(
  account: StoredAccount,
  draft: MailSendDraft,
  sender: MailAddressSummary,
  sentAt: Date,
  unread: boolean,
): DemoMessage {
  const html = outgoingHtml(draft.html);
  const sanitizedHtml = html ? sanitizedMessageHtml(html) : null;
  const messageId = `<${randomUUID()}@demo.emzero.invalid>`;
  const from = [sender];
  return {
    summary: {
      messageId,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      subject: draft.subject.trim(),
      from,
      to: draft.to,
      sentAt: sentAt.toISOString(),
      receivedAt: sentAt.toISOString(),
      unread,
      flagged: false,
      important: false,
      dueDate: null,
      color: null,
      size: draft.text.length + (sanitizedHtml?.length ?? 0),
    },
    detail: {
      messageId,
      subject: draft.subject.trim(),
      from,
      to: draft.to,
      cc: draft.cc,
      replyTo: [],
      sentAt: sentAt.toISOString(),
      text: draft.text.trim(),
      html: sanitizedHtml,
      htmlHasQuotedText: html ? hasQuotedHtml(html) : false,
      attachments: draft.attachments.map(({ filename, size }) => ({
        filename,
        contentType: 'application/octet-stream',
        size,
        related: false,
      })),
    },
  };
}

export function saveDemoDraft(
  account: StoredAccount,
  draft: MailSendDraft,
  sender: MailAddressSummary,
  previous?: MailDraftReference,
): MailDraftSaveResult {
  const drafts = specialFolder(account.id, '\\Drafts');
  if (!drafts) return { ok: false, message: 'Could not save draft: this account does not have a Drafts folder.' };
  if (previous?.folderPath === drafts.path) mailCache().deleteMessages(account.id, drafts.path, [previous.uid]);
  const [stored] = storeDemoMessages(account.id, drafts.path, [
    composedDemoMessage(account, draft, sender, new Date(), false),
  ]);
  return { ok: true, draft: { folderPath: drafts.path, uid: stored.uid }, message: 'Draft saved.' };
}

function publishMailboxChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.syncMailboxChanged);
  }
}

/**
 * Files the message in Sent. Mail addressed to a demo account, including the sender's own,
 * also lands in that account's Inbox, so a presenter can show mail arriving without any network.
 */
export async function sendDemoMessage(
  account: StoredAccount,
  draft: MailSendDraft,
  sentLabel: string,
  sender: MailAddressSummary,
): Promise<MailSendResult> {
  const sent = specialFolder(account.id, '\\Sent');
  if (!sent) return { ok: false, message: `Could not send: this account does not have a Sent folder.` };
  const sentAt = new Date();
  const message = composedDemoMessage(account, draft, sender, sentAt, false);
  const [sentMessage] = storeDemoMessages(account.id, sent.path, [message]);
  releaseOutgoingAttachments(draft.attachments);

  const recipients = new Set(
    [...draft.to, ...draft.cc, ...draft.bcc].map(({ address }) => address?.toLowerCase()),
  );
  let delivered = false;
  for (const recipient of await readAccounts()) {
    if (![...accountAddresses(recipient)].some((address) => recipients.has(address))) continue;
    const inbox = findInboxFolder(mailCache().listFolders(recipient.id));
    if (!inbox) continue;
    storeDemoMessages(recipient.id, inbox.path, [{
      ...message,
      summary: { ...message.summary, unread: true },
    }]);
    delivered = true;
  }
  if (delivered) publishMailboxChanged();

  return {
    ok: true,
    message: `${sentLabel} sent and saved to Sent.`,
    messageId: message.summary.messageId ?? undefined,
    savedToSent: true,
    sentMessage,
  };
}

const placeholderPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 58 >> stream
BT /F1 24 Tf 72 700 Td (Emzero demo attachment) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF
`;

/** Sample content for a demo attachment, so open and save behave like real files. */
export function demoAttachment(
  accountId: string,
  folderPath: string,
  uid: number,
  attachmentIndex: number,
): { filename: string; content: Buffer } {
  const attachment = mailCache().getMessageBody(accountId, folderPath, uid)?.attachments[attachmentIndex];
  if (!attachment || attachment.related) throw new Error('This attachment is no longer available.');
  const content = attachment.contentType === 'application/pdf'
    ? placeholderPdf
    : `This is a sample attachment from the Emzero demo mailbox: ${attachment.filename}\n`;
  return { filename: attachment.filename, content: Buffer.from(content) };
}
