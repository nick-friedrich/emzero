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

// The composer has already closed, so a message that cannot be sent is kept in Drafts.
async function fail(account: StoredAccount | undefined, job: OutgoingJob, reason: string): Promise<void> {
  const saved = account
    ? await saveMailDraft(account, job.draft, job.draftReference).catch(() => null)
    : null;
  if (saved?.ok && saved.draft) job.draftReference = saved.draft;
  job.status = {
    ...job.status,
    state: 'failed',
    message: saved?.ok ? `${reason} It was saved to Drafts.` : reason,
  };
  publish(job.status);
}

async function deliver(job: OutgoingJob): Promise<void> {
  const { status, draft } = job;
  const account = (await readAccounts()).find((candidate) => candidate.id === status.accountId);
  if (!account) return fail(undefined, job, 'Account not found.');
  const problem = sendDraftProblem(account, draft, status.kind);
  if (problem) return fail(account, job, problem);
  const result = await sendMessage(account, draft, status.kind).catch(() => ({
    ok: false as const,
    message: 'Could not send message.',
    sentMessage: undefined,
  }));
  if (!result.ok) return fail(account, job, result.message ?? 'Could not send message.');
  jobs.delete(status.jobId);
  if (job.draftReference) await deleteMailDraft(account, job.draftReference).catch(() => undefined);
  publish({ ...status, state: 'sent', message: result.message, sentMessage: result.sentMessage });
}

function start(job: OutgoingJob): void {
  job.status = { ...job.status, state: 'sending', message: undefined };
  jobs.set(job.status.jobId, job);
  publish(job.status);
  const delivery = deliver(job)
    .catch(() => fail(undefined, job, 'Could not send message.'))
    .finally(() => deliveries.delete(delivery));
  deliveries.add(delivery);
}

/**
 * Accepts a message for background delivery without awaiting anything, so the composer can
 * close at once. Looking up the account, validating, and sending all happen afterwards;
 * any failure is reported as a failed job with the message saved to Drafts.
 */
export function queueOutgoingMessage(
  accountId: string,
  draft: MailSendDraft,
  kind: MailSendKind,
  draftReference?: MailDraftReference,
): MailSendQueueResult {
  const jobId = randomUUID();
  start({
    status: { jobId, accountId, kind, subject: draft.subject.trim(), state: 'sending' },
    draft,
    draftReference,
  });
  return { ok: true, jobId };
}

export function retryOutgoingMessage(jobId: string): MailSendQueueResult {
  const job = jobs.get(jobId);
  if (!job || job.status.state !== 'failed') return { ok: false, message: 'This message is no longer waiting to be sent.' };
  start(job);
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
