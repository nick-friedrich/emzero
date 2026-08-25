import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dialog } from 'electron';
import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type {
  AttachmentSaveResult,
  AttachmentSelectionResult,
  MailOutgoingAttachment,
} from '../shared/accounts.js';
import type { StoredAccount } from './account-storage.js';
import { closeImap, createImapClient, errorMessage, resolveMailSecret } from './mail-runtime.js';

interface SelectedAttachment extends MailOutgoingAttachment {
  path: string;
}

const maximumAttachmentCount = 20;
const maximumAttachmentSize = 25 * 1024 * 1024;
const maximumTotalSize = 50 * 1024 * 1024;
const selectedAttachments = new Map<string, SelectedAttachment>();

export async function selectOutgoingAttachments(): Promise<AttachmentSelectionResult> {
  const result = await dialog.showOpenDialog({
    title: 'Attach files',
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return { ok: true, attachments: [] };
  if (result.filePaths.length > maximumAttachmentCount) {
    return { ok: false, attachments: [], message: 'Select no more than 20 files.' };
  }

  try {
    const attachments = await Promise.all(
      result.filePaths.map(async (filePath): Promise<SelectedAttachment> => {
        const details = await stat(filePath);
        if (!details.isFile()) throw new Error(`${path.basename(filePath)} is not a regular file.`);
        if (details.size > maximumAttachmentSize) {
          throw new Error(`${path.basename(filePath)} exceeds the 25 MB per-file limit.`);
        }
        return {
          id: randomUUID(),
          filename: path.basename(filePath),
          size: details.size,
          path: filePath,
        };
      }),
    );
    if (attachments.reduce((total, attachment) => total + attachment.size, 0) > maximumTotalSize) {
      return { ok: false, attachments: [], message: 'Selected files exceed 50 MB in total.' };
    }
    for (const attachment of attachments) selectedAttachments.set(attachment.id, attachment);
    while (selectedAttachments.size > 200) {
      const oldestId = selectedAttachments.keys().next().value;
      if (oldestId) selectedAttachments.delete(oldestId);
      else break;
    }
    return {
      ok: true,
      attachments: attachments.map(({ id, filename, size }) => ({ id, filename, size })),
    };
  } catch (error) {
    return { ok: false, attachments: [], message: errorMessage(error, '') };
  }
}

export async function resolveOutgoingAttachments(
  attachments: MailOutgoingAttachment[],
): Promise<Array<{ filename: string; content: Buffer }>> {
  if (attachments.length > maximumAttachmentCount) throw new Error('Attach no more than 20 files.');
  let total = 0;
  return Promise.all(
    attachments.map(async (attachment) => {
      const selected = selectedAttachments.get(attachment.id);
      if (
        !selected ||
        selected.filename !== attachment.filename ||
        selected.size !== attachment.size
      ) {
        throw new Error(`Select ${attachment.filename} again before sending.`);
      }
      const content = await readFile(selected.path);
      if (content.length !== selected.size || content.length > maximumAttachmentSize) {
        throw new Error(`${selected.filename} changed after it was selected.`);
      }
      total += content.length;
      if (total > maximumTotalSize) throw new Error('Attachments cannot exceed 50 MB in total.');
      return { filename: selected.filename, content };
    }),
  );
}

export function releaseOutgoingAttachments(attachments: MailOutgoingAttachment[]): void {
  for (const attachment of attachments) selectedAttachments.delete(attachment.id);
}

export async function saveMessageAttachment(
  account: StoredAccount,
  folderPath: string,
  uid: number,
  attachmentIndex: number,
): Promise<AttachmentSaveResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    password = await resolveMailSecret(account);
    imap = createImapClient(account, password, 30_000);
    await imap.connect();
    lock = await imap.getMailboxLock(folderPath, { readOnly: true });
    const fetched = await imap.fetchOne(uid, { source: true }, { uid: true });
    if (!fetched || !fetched.source) {
      return { ok: false, message: 'This message is no longer available.' };
    }
    const parsed = await simpleParser(fetched.source);
    const attachment = parsed.attachments[attachmentIndex];
    if (!attachment || attachment.related) {
      return { ok: false, message: 'This attachment is no longer available.' };
    }
    const filename = path.basename(attachment.filename || 'attachment');
    const content = attachment.content;
    lock.release();
    lock = null;
    await closeImap(imap);
    imap = null;
    const destination = await dialog.showSaveDialog({ title: 'Save attachment', defaultPath: filename });
    if (destination.canceled || !destination.filePath) return { ok: true, canceled: true };
    await writeFile(destination.filePath, content);
    return { ok: true, message: `${filename} saved.` };
  } catch (error) {
    return { ok: false, message: `Could not save attachment: ${errorMessage(error, password)}` };
  } finally {
    lock?.release();
    await closeImap(imap);
  }
}
