import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type {
  MailMessageSummary,
  MailSendDraft,
  MailSendResult,
} from '../shared/accounts.js';
import { validateReplyDraft, validateSendDraft } from '../shared/replies.js';
import type { StoredAccount } from './account-storage.js';
import { releaseOutgoingAttachments, resolveOutgoingAttachments } from './attachment-files.js';
import {
  closeImap,
  createImapClient,
  errorMessage,
  mailCache,
  resolveMailSecret,
  smtpAuthentication,
} from './mail-runtime.js';

export async function sendMessage(
  account: StoredAccount,
  draft: MailSendDraft,
  kind: 'reply' | 'message',
): Promise<MailSendResult> {
  const validationError = kind === 'reply' ? validateReplyDraft(draft) : validateSendDraft(draft);
  if (validationError) return { ok: false, message: validationError };
  const sentLabel = kind === 'reply' ? 'Reply' : 'Message';

  let password = '';
  try {
    password = await resolveMailSecret(account);
    const sentAt = new Date();
    const attachments = await resolveOutgoingAttachments(draft.attachments);
    const messageOptions = {
      from: { name: account.name, address: account.email },
      to: draft.to.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      cc: draft.cc.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      bcc: draft.bcc.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      subject: draft.subject.trim(),
      text: draft.text.trim(),
      date: sentAt,
      inReplyTo: draft.inReplyTo ?? undefined,
      references: draft.references,
      attachments,
    };
    const compiler = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'windows',
    });
    const compiled = await compiler.sendMail(messageOptions);
    if (!Buffer.isBuffer(compiled.message)) throw new Error('Could not create the email message.');

    const smtp = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: smtpAuthentication(account, password),
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 30_000,
    });
    let smtpMessageId = compiled.messageId;
    try {
      const result = await smtp.sendMail({
        raw: compiled.message,
        envelope: compiled.envelope,
      });
      smtpMessageId = result.messageId || smtpMessageId;
      releaseOutgoingAttachments(draft.attachments);
    } finally {
      smtp.close();
    }

    let imap: ImapFlow | null = null;
    let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
    try {
      imap = createImapClient(account, password, 30_000);
      await imap.connect();
      const folders = await imap.list();
      const sentFolder = folders.find(
        (folder) => !folder.flags.has('\\Noselect') && folder.specialUse === '\\Sent',
      );
      if (!sentFolder) {
        return {
          ok: true,
          message: `${sentLabel} sent, but this account has no Sent folder to save a copy in.`,
          messageId: smtpMessageId,
          savedToSent: false,
        };
      }

      lock = await imap.getMailboxLock(sentFolder.path);
      const existing = await imap.search(
        { header: { 'message-id': smtpMessageId } },
        { uid: true },
      );
      let sentUid = existing && existing.length > 0 ? existing.at(-1) : undefined;
      if (!sentUid) {
        const appended = await imap.append(sentFolder.path, compiled.message, ['\\Seen'], sentAt);
        if (!appended) throw new Error('The mail server did not save the Sent copy.');
        sentUid = appended.uid;
      }
      if (!sentUid) {
        const saved = await imap.search(
          { header: { 'message-id': smtpMessageId } },
          { uid: true },
        );
        sentUid = saved && saved.length > 0 ? saved.at(-1) : undefined;
      }

      const sentMessage: MailMessageSummary | undefined = sentUid
        ? {
            folderPath: sentFolder.path,
            uid: sentUid,
            messageId: smtpMessageId,
            inReplyTo: draft.inReplyTo,
            references: draft.references,
            subject: draft.subject.trim(),
            from: [{ name: account.name, address: account.email }],
            to: draft.to,
            sentAt: sentAt.toISOString(),
            receivedAt: null,
            unread: false,
            flagged: false,
            size: compiled.message.length,
          }
        : undefined;
      if (
        sentMessage &&
        mailCache().listFolders(account.id).some((folder) => folder.path === sentFolder.path)
      ) {
        const cached = mailCache().listMessages(account.id, sentFolder.path);
        const alreadyCached = cached.messages.some((message) => message.uid === sentMessage.uid);
        mailCache().replaceRecentMessages(
          account.id,
          sentFolder.path,
          [...cached.messages.filter((message) => message.uid !== sentMessage.uid), sentMessage],
          Math.max(cached.total, cached.messages.length) + (alreadyCached ? 0 : 1),
        );
        mailCache().putMessageBody(account.id, sentFolder.path, {
          uid: sentMessage.uid,
          messageId: sentMessage.messageId,
          subject: sentMessage.subject,
          from: sentMessage.from,
          to: sentMessage.to,
          cc: draft.cc,
          replyTo: [],
          sentAt: sentMessage.sentAt,
          text: draft.text.trim(),
          html: null,
          htmlHasQuotedText: false,
          attachments: draft.attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: 'application/octet-stream',
            size: attachment.size,
            related: false,
          })),
        });
      }
      return {
        ok: true,
        message: `${sentLabel} sent and saved to Sent.`,
        messageId: smtpMessageId,
        savedToSent: true,
        sentMessage,
      };
    } catch (error) {
      return {
        ok: true,
        message: `${sentLabel} sent, but the Sent copy could not be saved: ${errorMessage(error, password)}`,
        messageId: smtpMessageId,
        savedToSent: false,
      };
    } finally {
      lock?.release();
      await closeImap(imap);
    }
  } catch (error) {
    return {
      ok: false,
      message: `Could not send ${kind === 'reply' ? 'reply' : 'message'}: ${errorMessage(error, password)}`,
    };
  }
}
