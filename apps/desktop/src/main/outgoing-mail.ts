import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import {
  ACCOUNT_CHANNELS,
  type MailDraftReference,
  type MailSendDraft,
  type MailSendJob,
  type MailSendKind,
  type MailSendQueueResult,
} from '../shared/accounts.js';
import { readAccounts, type StoredAccount } from './account-storage.js';
import { deleteMailDraft, saveMailDraft } from './mail-drafts.js';
import { sendDraftProblem, sendMessage } from './message-sender.js';

interface OutgoingJob {
  status: MailSendJob;
  draft: MailSendDraft;
  /** The autosaved draft this message replaces: deleted once sent, rewritten if sending fails. */
  draftReference?: MailDraftReference;
}

// Sending and failed jobs. Sent jobs are dropped; failed ones stay for Retry until dismissed.
const jobs = new Map<string, OutgoingJob>();
const deliveries = new Set<Promise<void>>();

function publish(status: MailSendJob): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(ACCOUNT_CHANNELS.sendJobChanged, status);
    }
  }
}

async function deliver(account: StoredAccount, job: OutgoingJob): Promise<void> {
  const { status, draft } = job;
  const result = await sendMessage(account, draft, status.kind).catch(() => ({
    ok: false as const,
    message: 'Could not send message.',
    sentMessage: undefined,
  }));
  if (result.ok) {
    jobs.delete(status.jobId);
    if (job.draftReference) await deleteMailDraft(account, job.draftReference).catch(() => undefined);
    publish({ ...status, state: 'sent', message: result.message, sentMessage: result.sentMessage });
    return;
  }

  // The composer has already closed, so keep the message in Drafts rather than losing it.
  const saved = await saveMailDraft(account, draft, job.draftReference).catch(() => null);
  if (saved?.ok && saved.draft) job.draftReference = saved.draft;
  job.status = {
    ...status,
    state: 'failed',
    message: saved?.ok
      ? `${result.message ?? 'Could not send message.'} It was saved to Drafts.`
      : result.message ?? 'Could not send message.',
  };
  publish(job.status);
}

function start(account: StoredAccount, job: OutgoingJob): void {
  job.status = { ...job.status, state: 'sending', message: undefined };
  jobs.set(job.status.jobId, job);
  publish(job.status);
  const delivery = deliver(account, job).finally(() => deliveries.delete(delivery));
  deliveries.add(delivery);
}

/** Validates a draft and starts delivering it in the background, returning immediately. */
export function queueOutgoingMessage(
  account: StoredAccount,
  draft: MailSendDraft,
  kind: MailSendKind,
  draftReference?: MailDraftReference,
): MailSendQueueResult {
  const problem = sendDraftProblem(account, draft, kind);
  if (problem) return { ok: false, message: problem };
  const jobId = randomUUID();
  start(account, {
    status: { jobId, accountId: account.id, kind, subject: draft.subject.trim(), state: 'sending' },
    draft,
    draftReference,
  });
  return { ok: true, jobId };
}

export async function retryOutgoingMessage(jobId: string): Promise<MailSendQueueResult> {
  const job = jobs.get(jobId);
  if (!job || job.status.state !== 'failed') return { ok: false, message: 'This message is no longer waiting to be sent.' };
  const account = (await readAccounts()).find((candidate) => candidate.id === job.status.accountId);
  if (!account) return { ok: false, message: 'Account not found.' };
  start(account, job);
  return { ok: true, jobId };
}

/** Forgets a failed message; its copy stays in Drafts. */
export function dismissOutgoingMessage(jobId: string): void {
  if (jobs.get(jobId)?.status.state === 'failed') jobs.delete(jobId);
}

export function hasOutgoingDeliveries(): boolean {
  return deliveries.size > 0;
}

/** Resolves once every message being sent has finished, or after `timeoutMs`. */
export async function waitForOutgoingDeliveries(timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...deliveries]),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  clearTimeout(timer);
}
