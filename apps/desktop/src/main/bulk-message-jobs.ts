import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { ImapFlow } from 'imapflow';
import {
  ACCOUNT_CHANNELS,
  chunkMessageUids,
  type BulkMessageAction,
  type BulkMessageGroup,
  type BulkMessageJobProgress,
  type BulkMessageJobRequest,
  type BulkMessageJobStartResult,
} from '../shared/accounts.js';
import { listAccountFolders } from './account-folders.js';
import { readAccounts, type StoredAccount } from './account-storage.js';
import {
  moveDestination,
  transferFolderMessages,
  validMessageUids,
} from './message-actions.js';
import {
  closeImap,
  createImapClient,
  errorMessage,
  mailCache,
  resolveMailSecret,
} from './mail-runtime.js';

interface ActiveBulkMessageJob {
  id: string;
  action: BulkMessageAction;
  total: number;
  processed: number;
  cancelRequested: boolean;
}

let activeBulkMessageJob: ActiveBulkMessageJob | null = null;
const bulkMessageChunkSize = 50;

function publishBulkMessageProgress(progress: BulkMessageJobProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.bulkMessageJobChanged, progress);
  }
}

export function validBulkMessageJobRequest(value: unknown): value is BulkMessageJobRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<BulkMessageJobRequest>;
  if (!['read', 'unread', 'star', 'unstar', 'archive', 'move', 'delete'].includes(request.action ?? '')) return false;
  if (!Array.isArray(request.groups) || request.groups.length === 0 || request.groups.length > 100) {
    return false;
  }
  let total = 0;
  for (const group of request.groups) {
    if (
      !group ||
      typeof group.accountId !== 'string' ||
      !group.accountId ||
      typeof group.folderPath !== 'string' ||
      !group.folderPath ||
      (request.action === 'move' &&
        (typeof group.destinationPath !== 'string' || !group.destinationPath)) ||
      (group.destinationAccountId !== undefined &&
        (typeof group.destinationAccountId !== 'string' || !group.destinationAccountId)) ||
      !validMessageUids(group.uids)
    ) {
      return false;
    }
    total += group.uids.length;
  }
  return total <= 20_000;
}

export function bulkJobProgress(
  job: ActiveBulkMessageJob,
  state: BulkMessageJobProgress['state'],
  update: Partial<BulkMessageJobProgress> = {},
): BulkMessageJobProgress {
  return {
    jobId: job.id,
    action: job.action,
    state,
    total: job.total,
    processed: job.processed,
    ...update,
  };
}

async function processBulkMessageGroup(
  job: ActiveBulkMessageJob,
  account: StoredAccount,
  group: BulkMessageGroup,
): Promise<void> {
  let password = '';
  let imap: ImapFlow | null = null;
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;
  try {
    password = await resolveMailSecret(account);
    imap = createImapClient(account, password);
    await imap.connect();
    lock = await imap.getMailboxLock(group.folderPath);
    const trash =
      job.action === 'delete'
        ? mailCache()
            .listFolders(account.id)
            .find((folder) => folder.selectable && folder.specialUse === '\\Trash')
        : undefined;
    const moveTo =
      job.action === 'archive' || job.action === 'move'
        ? moveDestination(account.id, group.folderPath, job.action, group.destinationPath)
        : undefined;
    if ((job.action === 'archive' || job.action === 'move') && !moveTo) {
      throw new Error(
        job.action === 'archive'
          ? 'This account does not have an Archive folder.'
          : 'Choose a different destination folder.',
      );
    }

    for (const uids of chunkMessageUids(group.uids, bulkMessageChunkSize)) {
      if (job.cancelRequested) return;
      const changed =
        job.action === 'read'
          ? await imap.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
          : job.action === 'unread'
            ? await imap.messageFlagsRemove(uids, ['\\Seen'], { uid: true })
            : job.action === 'star'
              ? await imap.messageFlagsAdd(uids, ['\\Flagged'], { uid: true })
              : job.action === 'unstar'
                ? await imap.messageFlagsRemove(uids, ['\\Flagged'], { uid: true })
            : moveTo
              ? await imap.messageMove(uids, moveTo.path, { uid: true })
              : trash && trash.path !== group.folderPath
                ? await imap.messageMove(uids, trash.path, { uid: true })
                : await imap.messageDelete(uids, { uid: true });
      if (!changed) throw new Error('The messages are no longer available.');

      if (job.action === 'delete') {
        mailCache().deleteMessages(account.id, group.folderPath, uids);
      } else if (moveTo) {
        mailCache().moveMessages(account.id, group.folderPath, moveTo.path, uids);
      } else if (job.action === 'read' || job.action === 'unread') {
        mailCache().setMessagesUnread(account.id, group.folderPath, uids, job.action === 'unread');
      } else {
        mailCache().setMessagesFlagged(account.id, group.folderPath, uids, job.action === 'star');
      }
      job.processed += uids.length;
      const folder = mailCache()
        .listFolders(account.id)
        .find((candidate) => candidate.path === group.folderPath);
      publishBulkMessageProgress(
        bulkJobProgress(job, job.cancelRequested ? 'stopping' : 'running', {
          accountId: account.id,
          folderPath: group.folderPath,
          processedUids: uids,
          folder,
        }),
      );
    }
  } catch (error) {
    throw new Error(errorMessage(error, password), { cause: error });
  } finally {
    lock?.release();
    await closeImap(imap);
  }
}

async function runBulkMessageJob(
  job: ActiveBulkMessageJob,
  request: BulkMessageJobRequest,
): Promise<void> {
  try {
    const accounts = await readAccounts();
    for (const group of request.groups) {
      if (job.cancelRequested) break;
      const account = accounts.find((candidate) => candidate.id === group.accountId);
      if (!account) throw new Error('Account not found.');
      const destinationAccount = group.destinationAccountId
        ? accounts.find((candidate) => candidate.id === group.destinationAccountId)
        : account;
      if (job.action === 'move' && destinationAccount?.id !== account.id) {
        if (!destinationAccount || !group.destinationPath) {
          throw new Error('Destination account not found.');
        }
        await transferFolderMessages(
          account,
          group.folderPath,
          group.uids,
          destinationAccount,
          group.destinationPath,
          (uid) => {
            job.processed += 1;
            const folder = mailCache()
              .listFolders(account.id)
              .find((candidate) => candidate.path === group.folderPath);
            publishBulkMessageProgress(
              bulkJobProgress(job, job.cancelRequested ? 'stopping' : 'running', {
                accountId: account.id,
                folderPath: group.folderPath,
                processedUids: [uid],
                folder,
              }),
            );
          },
          () => job.cancelRequested,
        );
      } else {
        await processBulkMessageGroup(job, account, group);
      }
    }
    if (!job.cancelRequested) {
      for (const accountId of new Set(request.groups.map((group) => group.accountId))) {
        const account = accounts.find((candidate) => candidate.id === accountId);
        if (!account) continue;
        const result = await listAccountFolders(account, true).catch(() => null);
        if (!result?.ok) continue;
        for (const group of request.groups.filter((candidate) => candidate.accountId === accountId)) {
          publishBulkMessageProgress(
            bulkJobProgress(job, job.cancelRequested ? 'stopping' : 'running', {
              accountId,
              folderPath: group.folderPath,
              folder: result.folders.find((folder) => folder.path === group.folderPath),
            }),
          );
        }
      }
    }
    publishBulkMessageProgress(
      bulkJobProgress(job, job.cancelRequested ? 'stopped' : 'completed'),
    );
  } catch (error) {
    publishBulkMessageProgress(
      bulkJobProgress(job, 'error', {
        message: `The bulk action stopped: ${errorMessage(error, '')}`,
      }),
    );
  } finally {
    if (activeBulkMessageJob?.id === job.id) activeBulkMessageJob = null;
  }
}

export function startBulkMessageJob(value: unknown): BulkMessageJobStartResult {
  if (!validBulkMessageJobRequest(value)) {
    return { ok: false, message: 'Invalid bulk message action.' };
  }
  if (activeBulkMessageJob) {
    return { ok: false, message: 'Another bulk message action is already running.' };
  }
  const request: BulkMessageJobRequest = {
    action: value.action,
    groups: value.groups.map((group) => ({
      accountId: group.accountId,
      folderPath: group.folderPath,
      uids: [...new Set(group.uids)],
      ...(group.destinationAccountId ? { destinationAccountId: group.destinationAccountId } : {}),
      ...(group.destinationPath ? { destinationPath: group.destinationPath } : {}),
    })),
  };
  const job: ActiveBulkMessageJob = {
    id: randomUUID(),
    action: request.action,
    total: request.groups.reduce((total, group) => total + group.uids.length, 0),
    processed: 0,
    cancelRequested: false,
  };
  activeBulkMessageJob = job;
  publishBulkMessageProgress(bulkJobProgress(job, 'running'));
  void runBulkMessageJob(job, request);
  return { ok: true, jobId: job.id };
}

export function cancelBulkMessageJob(jobId: unknown): boolean {
  if (typeof jobId !== 'string' || activeBulkMessageJob?.id !== jobId) return false;
  activeBulkMessageJob.cancelRequested = true;
  publishBulkMessageProgress(bulkJobProgress(activeBulkMessageJob, 'stopping'));
  return true;
}
