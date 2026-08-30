import { ImapFlow } from 'imapflow';
import {
  manageableFolder,
  type FolderCreateRequest,
  type FolderListResult,
  type FolderMoveRequest,
  type FolderMutationResult,
  type FolderRenameRequest,
  type MailFolderSummary,
} from '../shared/accounts.js';
import type { StoredAccount } from './account-storage.js';
import { deleteSubscribedFolder, subscribeListedFolders } from './folder-subscriptions.js';
import {
  closeImap,
  createImapClient,
  errorMessage,
  mailCache,
  resolveMailSecret,
} from './mail-runtime.js';

async function refreshedFolders(imap: ImapFlow, accountId: string): Promise<MailFolderSummary[]> {
  const listedFolders = await imap.list({ statusQuery: { unseen: true, messages: true } });
  await subscribeListedFolders(imap, listedFolders);
  const folders: MailFolderSummary[] = listedFolders.map((folder) => ({
    path: folder.path,
    name: folder.name,
    parentPath: folder.parentPath,
    delimiter: folder.delimiter,
    specialUse: folder.specialUse ?? null,
    selectable: !folder.flags.has('\\Noselect'),
    unreadCount: folder.status?.unseen ?? 0,
    totalCount: folder.status?.messages ?? 0,
  }));
  mailCache().replaceFolders(accountId, folders);
  return mailCache().listFolders(accountId);
}

export async function listAccountFolders(
  account: StoredAccount,
  refresh = false,
): Promise<FolderListResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  const cachedFolders = mailCache().listFolders(account.id);

  if (cachedFolders.length > 0 && !refresh) {
    return { ok: true, folders: cachedFolders, source: 'cache' };
  }

  try {
    password = await resolveMailSecret(account);
    imap = createImapClient(account, password, 15_000);
    await imap.connect();
    const folders = await refreshedFolders(imap, account.id);
    return { ok: true, folders, source: 'server' };
  } catch (error) {
    if (cachedFolders.length > 0) {
      return {
        ok: true,
        folders: cachedFolders,
        source: 'cache',
        message: `Could not refresh folders. Showing saved data. ${errorMessage(error, password)}`,
      };
    }
    return {
      ok: false,
      folders: [],
      message: `Could not load folders: ${errorMessage(error, password)}`,
    };
  } finally {
    await closeImap(imap);
  }
}

export function validFolderName(name: string, delimiter: string): boolean {
  const trimmed = name.trim();
  return (
    Boolean(trimmed) &&
    trimmed.length <= 200 &&
    !trimmed.includes(delimiter) &&
    !/[\r\n\0]/.test(trimmed)
  );
}

export function childFolderPath(parentPath: string, name: string, delimiter: string): string {
  return parentPath ? `${parentPath}${delimiter}${name}` : name;
}

async function mutateAccountFolders(
  account: StoredAccount,
  operation: (imap: ImapFlow) => Promise<void>,
): Promise<FolderMutationResult> {
  let password = '';
  let imap: ImapFlow | null = null;
  try {
    password = await resolveMailSecret(account);
    imap = createImapClient(account, password);
    await imap.connect();
    await operation(imap);
    return { ok: true, folders: await refreshedFolders(imap, account.id), source: 'server' };
  } catch (error) {
    return {
      ok: false,
      folders: mailCache().listFolders(account.id),
      message: `Could not update folders: ${errorMessage(error, password)}`,
    };
  } finally {
    await closeImap(imap);
  }
}

export async function createAccountFolder(
  account: StoredAccount,
  request: FolderCreateRequest,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const parent = request.parentPath
    ? folders.find((folder) => folder.path === request.parentPath)
    : undefined;
  if (request.parentPath && !parent) {
    return { ok: false, folders, message: 'The parent folder no longer exists.' };
  }
  const delimiter = parent?.delimiter ?? folders[0]?.delimiter ?? '/';
  const name = request.name.trim();
  if (!validFolderName(name, delimiter)) {
    return { ok: false, folders, message: `Folder names cannot contain “${delimiter}”.` };
  }
  const path = childFolderPath(request.parentPath, name, delimiter);
  if (folders.some((folder) => folder.path === path)) {
    return { ok: false, folders, message: 'A folder with this name already exists here.' };
  }
  return mutateAccountFolders(account, async (imap) => {
    await imap.mailboxCreate(path);
  });
}

export async function renameAccountFolder(
  account: StoredAccount,
  request: FolderRenameRequest,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const folder = folders.find((candidate) => candidate.path === request.folderPath);
  if (!folder || !manageableFolder(folder)) {
    return { ok: false, folders, message: 'This provider-managed folder cannot be renamed.' };
  }
  const name = request.name.trim();
  if (!validFolderName(name, folder.delimiter)) {
    return { ok: false, folders, message: `Folder names cannot contain “${folder.delimiter}”.` };
  }
  const nextPath = childFolderPath(folder.parentPath, name, folder.delimiter);
  if (nextPath === folder.path) return { ok: true, folders, source: 'cache' };
  if (folders.some((candidate) => candidate.path === nextPath)) {
    return { ok: false, folders, message: 'A folder with this name already exists here.' };
  }
  const siblings = folders.filter((candidate) => candidate.parentPath === folder.parentPath);
  const currentIndex = siblings.findIndex((candidate) => candidate.path === folder.path);
  const beforePath = siblings[currentIndex + 1]?.path ?? null;
  const result = await mutateAccountFolders(account, async (imap) => {
    await imap.mailboxRename(folder.path, nextPath);
  });
  if (!result.ok) return result;
  const orderedPaths = result.folders
    .filter((candidate) => candidate.parentPath === folder.parentPath && candidate.path !== nextPath)
    .map((candidate) => candidate.path);
  const beforeIndex = beforePath ? orderedPaths.indexOf(beforePath) : orderedPaths.length;
  orderedPaths.splice(beforeIndex < 0 ? orderedPaths.length : beforeIndex, 0, nextPath);
  mailCache().reorderFolderSiblings(account.id, folder.parentPath, orderedPaths);
  return { ...result, folders: mailCache().listFolders(account.id) };
}

export async function moveAccountFolder(
  account: StoredAccount,
  request: FolderMoveRequest,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const folder = folders.find((candidate) => candidate.path === request.folderPath);
  if (!folder || !manageableFolder(folder)) {
    return { ok: false, folders, message: 'This provider-managed folder cannot be moved.' };
  }
  const parent = request.parentPath
    ? folders.find((candidate) => candidate.path === request.parentPath)
    : undefined;
  if (request.parentPath && !parent) {
    return { ok: false, folders, message: 'The destination folder no longer exists.' };
  }
  if (
    request.parentPath === folder.path ||
    (request.parentPath && request.parentPath.startsWith(`${folder.path}${folder.delimiter}`))
  ) {
    return { ok: false, folders, message: 'A folder cannot be moved inside itself.' };
  }
  const nextPath = childFolderPath(request.parentPath, folder.name, folder.delimiter);
  if (nextPath !== folder.path && folders.some((candidate) => candidate.path === nextPath)) {
    return { ok: false, folders, message: 'A folder with this name already exists there.' };
  }

  const applyOrder = (freshFolders: MailFolderSummary[], movedPath: string) => {
    const siblings = freshFolders
      .filter(
        (candidate) => candidate.parentPath === request.parentPath && candidate.path !== movedPath,
      )
      .map((candidate) => candidate.path);
    const beforeIndex = request.beforePath ? siblings.indexOf(request.beforePath) : siblings.length;
    if (request.beforePath && beforeIndex < 0) {
      throw new Error('The drop position is no longer available.');
    }
    siblings.splice(beforeIndex, 0, movedPath);
    mailCache().reorderFolderSiblings(account.id, request.parentPath, siblings);
  };

  if (nextPath === folder.path) {
    try {
      applyOrder(folders, folder.path);
      return { ok: true, folders: mailCache().listFolders(account.id), source: 'cache' };
    } catch (error) {
      return { ok: false, folders, message: errorMessage(error, '') };
    }
  }

  const result = await mutateAccountFolders(account, async (imap) => {
    await imap.mailboxRename(folder.path, nextPath);
  });
  if (!result.ok) return result;
  try {
    applyOrder(result.folders, nextPath);
    return { ...result, folders: mailCache().listFolders(account.id) };
  } catch (error) {
    return { ok: false, folders: result.folders, message: errorMessage(error, '') };
  }
}

export async function deleteAccountFolder(
  account: StoredAccount,
  targetPath: string,
): Promise<FolderMutationResult> {
  const folders = mailCache().listFolders(account.id);
  const folder = folders.find((candidate) => candidate.path === targetPath);
  if (!folder || !manageableFolder(folder)) {
    return { ok: false, folders, message: 'This provider-managed folder cannot be deleted.' };
  }
  return mutateAccountFolders(account, async (imap) => {
    await deleteSubscribedFolder(imap, folder.path);
  });
}
