import type { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type {
  MailDraftReference,
  MailDraftSaveResult,
  MailSendDraft,
  MessageOperationResult,
} from '../shared/accounts.js';
import type { StoredAccount } from './account-storage.js';
import { resolveOutgoingAttachments } from './attachment-files.js';
import { closeImap, createImapClient, decryptPassword, errorMessage, mailCache } from './mail-runtime.js';

export function findDraftsFolder(
  folders: Array<{ path: string; specialUse?: string | null; flags: Set<string> }>,
): string | null {
  return folders.find(
    (folder) => !folder.flags.has('\\Noselect') && folder.specialUse === '\\Drafts',
  )?.path ?? null;
}

export async function saveMailDraft(
  account: StoredAccount,
  draft: MailSendDraft,
  previous?: MailDraftReference,
): Promise<MailDraftSaveResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    password = await decryptPassword(account);
    const attachments = await resolveOutgoingAttachments(draft.attachments);
    const compiler = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    const compiled = await compiler.sendMail({
      from: { name: account.name, address: account.email },
      to: draft.to.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      cc: draft.cc.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      bcc: draft.bcc.map(({ name, address }) => ({ name: name ?? '', address: address! })),
      subject: draft.subject.trim(),
      text: draft.text,
      inReplyTo: draft.inReplyTo ?? undefined,
      references: draft.references,
      attachments,
    });
    if (!Buffer.isBuffer(compiled.message)) throw new Error('Could not create the draft message.');

    imap = createImapClient(account, password, 30_000);
    await imap.connect();
    const folders = await imap.list();
    const draftsPath = findDraftsFolder(folders);
    if (!draftsPath) throw new Error('This account does not have a Drafts folder.');
    lock = await imap.getMailboxLock(draftsPath);
    const appended = await imap.append(draftsPath, compiled.message, ['\\Draft'], new Date());
    let uid = appended ? appended.uid : undefined;
    if (!uid) {
      const matches = await imap.search(
        { header: { 'message-id': compiled.messageId } },
        { uid: true },
      );
      uid = matches && matches.length > 0 ? matches.at(-1) : undefined;
    }
    if (!uid) throw new Error('The server saved the draft but did not return its identifier.');
    if (previous?.folderPath === draftsPath && previous.uid !== uid) {
      await imap.messageDelete(previous.uid, { uid: true });
    }
    mailCache().invalidateFolder(account.id, draftsPath);
    return { ok: true, draft: { folderPath: draftsPath, uid }, message: 'Draft saved.' };
  } catch (error) {
    return { ok: false, message: `Could not save draft: ${errorMessage(error, password)}` };
  } finally {
    lock?.release();
    await closeImap(imap);
  }
}

export async function deleteMailDraft(
  account: StoredAccount,
  draft: MailDraftReference,
): Promise<MessageOperationResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    password = await decryptPassword(account);
    imap = createImapClient(account, password);
    await imap.connect();
    lock = await imap.getMailboxLock(draft.folderPath);
    await imap.messageDelete(draft.uid, { uid: true });
    mailCache().deleteMessages(account.id, draft.folderPath, [draft.uid]);
    mailCache().invalidateFolder(account.id, draft.folderPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `Could not remove draft: ${errorMessage(error, password)}` };
  } finally {
    lock?.release();
    await closeImap(imap);
  }
}
