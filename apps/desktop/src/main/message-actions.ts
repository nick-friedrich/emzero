import type { ImapFlow } from 'imapflow';
import {
  findArchiveFolder,
  type MailFolderSummary,
  type MessageOperationResult,
} from '../shared/accounts.js';
import type { StoredAccount } from './account-storage.js';
import {
  closeImap,
  createImapClient,
  errorMessage,
  mailCache,
  resolveMailSecret,
  withAccountImap,
} from './mail-runtime.js';

export function validMessageUids(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((uid) => typeof uid === 'number' && Number.isInteger(uid) && uid > 0)
  );
}

export function findMoveDestination(
  folders: MailFolderSummary[],
  sourcePath: string,
  action: 'archive' | 'move',
  destinationPath?: string,
): MailFolderSummary | undefined {
  const destination =
    action === 'archive'
      ? findArchiveFolder(folders)
      : folders.find((folder) => folder.path === destinationPath && folder.selectable);
  return destination?.path === sourcePath ? undefined : destination;
}

export function moveDestination(
  accountId: string,
  folderPath: string,
  action: 'archive' | 'move',
  destinationPath?: string,
): MailFolderSummary | undefined {
  return findMoveDestination(
    mailCache().listFolders(accountId),
    folderPath,
    action,
    destinationPath,
  );
}

export async function changeMessageUnread(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
  unread: boolean,
): Promise<MessageOperationResult> {
  let password = '';
  try {
    return await withAccountImap(account, async (imap, secret) => {
      password = secret;
      const lock = await imap.getMailboxLock(folderPath);
      try {
        const changed = unread
          ? await imap.messageFlagsRemove(uids, ['\\Seen'], { uid: true })
          : await imap.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
        if (!changed) return { ok: false, message: 'The messages are no longer available.' };
        mailCache().setMessagesUnread(account.id, folderPath, uids, unread);
        return { ok: true };
      } finally {
        lock.release();
      }
    });
  } catch (error) {
    return { ok: false, message: `Could not update messages: ${errorMessage(error, password)}` };
  }
}

export async function changeMessageFlagged(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
  flagged: boolean,
): Promise<MessageOperationResult> {
  let password = '';
  try {
    return await withAccountImap(account, async (imap, secret) => {
      password = secret;
      const lock = await imap.getMailboxLock(folderPath);
      try {
        const changed = flagged
          ? await imap.messageFlagsAdd(uids, ['\\Flagged'], { uid: true })
          : await imap.messageFlagsRemove(uids, ['\\Flagged'], { uid: true });
        if (!changed) return { ok: false, message: 'The messages are no longer available.' };
        mailCache().setMessagesFlagged(account.id, folderPath, uids, flagged);
        return { ok: true };
      } finally {
        lock.release();
      }
    });
  } catch (error) {
    return { ok: false, message: `Could not update messages: ${errorMessage(error, password)}` };
  }
}

export async function deleteFolderMessages(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
): Promise<MessageOperationResult> {
  let password = '';
  try {
    return await withAccountImap(account, async (imap, secret) => {
      password = secret;
      const lock = await imap.getMailboxLock(folderPath);
      try {
        const trash = mailCache()
          .listFolders(account.id)
          .find((folder) => folder.selectable && folder.specialUse === '\\Trash');
        const deleted =
          trash && trash.path !== folderPath
            ? await imap.messageMove(uids, trash.path, { uid: true })
            : await imap.messageDelete(uids, { uid: true });
        if (!deleted) return { ok: false, message: 'The messages are no longer available.' };
        mailCache().deleteMessages(account.id, folderPath, uids);
        return { ok: true };
      } finally {
        lock.release();
      }
    });
  } catch (error) {
    return { ok: false, message: `Could not delete messages: ${errorMessage(error, password)}` };
  }
}

export async function moveFolderMessages(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
  destinationAccount: StoredAccount,
  destinationPath: string,
): Promise<MessageOperationResult> {
  if (destinationAccount.id !== account.id) {
    try {
      await transferFolderMessages(account, folderPath, uids, destinationAccount, destinationPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `Could not move messages: ${errorMessage(error, '')}` };
    }
  }
  const destination = moveDestination(account.id, folderPath, 'move', destinationPath);
  if (!destination) return { ok: false, message: 'Choose a different destination folder.' };

  let password = '';
  try {
    return await withAccountImap(account, async (imap, secret) => {
      password = secret;
      const lock = await imap.getMailboxLock(folderPath);
      try {
        const moved = await imap.messageMove(uids, destination.path, { uid: true });
        if (!moved) return { ok: false, message: 'The messages are no longer available.' };
        mailCache().moveMessages(account.id, folderPath, destination.path, uids);
        return { ok: true };
      } finally {
        lock.release();
      }
    });
  } catch (error) {
    return { ok: false, message: `Could not move messages: ${errorMessage(error, password)}` };
  }
}

export function appendableFlags(flags: Set<string> | undefined): string[] {
  const supported = new Set(['\\seen', '\\answered', '\\flagged', '\\draft']);
  return [...(flags ?? [])].filter((flag) => supported.has(flag.toLowerCase()));
}

export async function transferFolderMessages(
  sourceAccount: StoredAccount,
  sourcePath: string,
  uids: number[],
  destinationAccount: StoredAccount,
  destinationPath: string,
  onTransferred?: (uid: number) => void,
  shouldStop?: () => boolean,
): Promise<void> {
  const destination = mailCache()
    .listFolders(destinationAccount.id)
    .find((folder) => folder.path === destinationPath && folder.selectable);
  if (!destination) throw new Error('Choose a valid destination folder.');

  let sourcePassword = '';
  let destinationPassword = '';
  let sourceImap: ImapFlow | null = null;
  let destinationImap: ImapFlow | null = null;
  let sourceLock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    [sourcePassword, destinationPassword] = await Promise.all([
      resolveMailSecret(sourceAccount),
      resolveMailSecret(destinationAccount),
    ]);
    sourceImap = createImapClient(sourceAccount, sourcePassword, 30_000);
    destinationImap = createImapClient(destinationAccount, destinationPassword, 30_000);
    await Promise.all([sourceImap.connect(), destinationImap.connect()]);
    sourceLock = await sourceImap.getMailboxLock(sourcePath);

    for (const uid of uids) {
      if (shouldStop?.()) return;
      const message = await sourceImap.fetchOne(
        uid,
        { source: true, flags: true, internalDate: true },
        { uid: true },
      );
      if (!message || !message.source) throw new Error('A source message is no longer available.');
      const appended = await destinationImap.append(
        destination.path,
        message.source,
        appendableFlags(message.flags),
        message.internalDate,
      );
      if (!appended) throw new Error('The destination server did not accept a message.');
      const deleted = await sourceImap.messageDelete(uid, { uid: true });
      if (!deleted) {
        throw new Error('A message was copied, but could not be removed from the source account.');
      }
      mailCache().transferMessages(
        sourceAccount.id,
        sourcePath,
        destinationAccount.id,
        destination.path,
        [uid],
      );
      onTransferred?.(uid);
    }
  } catch (error) {
    const sourceSafeMessage = errorMessage(error, sourcePassword);
    const safeMessage = destinationPassword
      ? sourceSafeMessage.replaceAll(destinationPassword, '••••••••')
      : sourceSafeMessage;
    throw new Error(safeMessage, { cause: error });
  } finally {
    sourceLock?.release();
    for (const imap of [sourceImap, destinationImap]) await closeImap(imap);
  }
}
