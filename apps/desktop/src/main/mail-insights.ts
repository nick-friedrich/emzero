import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { simpleParser } from 'mailparser';
import {
  ACCOUNT_CHANNELS,
  findInboxFolder,
  type MailAddressSummary,
} from '../shared/accounts.js';
import {
  BASE_INSIGHT_QUESTIONS,
  INSIGHTS_RECENT_MESSAGE_LIMIT,
  isMailCategory,
  JEV_DECISIONS_ENDPOINT,
  JEV_MODEL,
  MAX_SMART_INBOXES,
  RULE_QUESTION_PREFIX,
  sanitizedSmartInboxSettings,
  SMART_INBOX_CHANNELS,
  smartInboxContains,
  smartInboxRuleQuestion,
  validateSmartInboxDraft,
  type MailInsightsStatus,
  type SmartInboxDraft,
  type SmartInboxOperationResult,
  type SmartInboxSettings,
} from '../shared/mail-insights.js';
import { readOpenRouterApiKey } from './ai-assistant.js';
import { readAccounts, type StoredAccount } from './account-storage.js';
import { mailCache, withAccountImap } from './mail-runtime.js';
import type { BaseMessageInsights, InsightCandidate } from './mail-cache.js';

const PREVIEW_SOURCE_BYTES = 16_000;
const PREVIEW_TEXT_LENGTH = 700;
const REQUEST_CONCURRENCY = 4;
const PUBLISH_EVERY = 40;

// ---------------------------------------------------------------------------
// Settings storage

const settingsPath = () => path.join(app.getPath('userData'), 'smart-inboxes.json');

export async function readSmartInboxSettings(): Promise<SmartInboxSettings> {
  try {
    return sanitizedSmartInboxSettings(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return { enabled: false, inboxes: [] };
    }
    throw error;
  }
}

async function writeSmartInboxSettings(settings: SmartInboxSettings): Promise<void> {
  const target = settingsPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

// Serialize read-modify-write cycles so concurrent IPC calls never drop an edit.
let settingsQueue: Promise<unknown> = Promise.resolve();

function updateSmartInboxSettings(
  change: (settings: SmartInboxSettings) => SmartInboxSettings | string,
): Promise<SmartInboxOperationResult> {
  const next = settingsQueue.then(async (): Promise<SmartInboxOperationResult> => {
    const updated = change(await readSmartInboxSettings());
    if (typeof updated === 'string') return { ok: false, message: updated };
    await writeSmartInboxSettings(updated);
    return { ok: true, settings: updated };
  });
  settingsQueue = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// Status and change publication

let status: MailInsightsStatus = { state: 'idle' };

function publishChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SMART_INBOX_CHANNELS.changed);
  }
}

function publishMailboxChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ACCOUNT_CHANNELS.syncMailboxChanged);
  }
}

function setStatus(next: MailInsightsStatus): void {
  if (next.state === status.state && next.message === status.message) return;
  status = next;
  publishChanged();
}

// ---------------------------------------------------------------------------
// Jev client

type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number }
  | { type: 'score'; score: number; confidence: number };

class JevRequestError extends Error {
  constructor(message: string, readonly fatal: boolean) {
    super(message);
  }
}

async function askJev(
  apiKey: string,
  state: Record<string, unknown>,
  questions: Record<string, unknown>,
): Promise<Record<string, JevAnswer>> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(JEV_DECISIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': 'Emzero',
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const value: unknown = await response.json();
      const answers = value && typeof value === 'object'
        ? (value as { answers?: unknown }).answers
        : null;
      if (!answers || typeof answers !== 'object') {
        throw new JevRequestError('OpenRouter returned an invalid answer.', false);
      }
      return answers as Record<string, JevAnswer>;
    }
    if (response.status === 401 || response.status === 403) {
      throw new JevRequestError('OpenRouter rejected the saved API key.', true);
    }
    if (response.status === 402) {
      throw new JevRequestError('Your OpenRouter account is out of credits.', true);
    }
    const retryable = [429, 500, 502, 503, 524, 529].includes(response.status);
    if (!retryable || attempt >= 2) {
      throw new JevRequestError(`OpenRouter returned HTTP ${response.status}.`, false);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 3 ** attempt));
  }
}

function probability(answer: JevAnswer | undefined): number | null {
  return answer?.type === 'noul' && Number.isFinite(answer.noul)
    ? Math.min(1, Math.max(0, answer.noul))
    : null;
}

function baseInsights(answers: Record<string, JevAnswer>): BaseMessageInsights | null {
  const category = answers.category;
  const urgency = answers.urgency;
  const needsReply = probability(answers.needs_reply);
  if (category?.type !== 'choice' || urgency?.type !== 'score' || needsReply === null) return null;
  return {
    category: isMailCategory(category.choice) ? category.choice : null,
    categoryConfidence: Number.isFinite(category.confidence) ? category.confidence : 0,
    needsReply,
    urgency: Number.isFinite(urgency.score) ? urgency.score : 0,
    urgencyConfidence: Number.isFinite(urgency.confidence) ? urgency.confidence : 0,
  };
}

// ---------------------------------------------------------------------------
// Message previews

interface MessagePreview {
  mailingList: boolean;
  automated: boolean;
  text: string;
}

function previewText(value: string | undefined): string {
  return (value ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_TEXT_LENGTH);
}

async function fetchPreviews(
  account: StoredAccount,
  folderPath: string,
  uids: number[],
): Promise<Map<number, MessagePreview>> {
  const previews = new Map<number, MessagePreview>();
  try {
    await withAccountImap(
      account,
      async (imap) => {
        const lock = await imap.getMailboxLock(folderPath, { readOnly: true });
        try {
          for await (const message of imap.fetch(
            uids,
            { uid: true, source: { start: 0, maxLength: PREVIEW_SOURCE_BYTES } },
            { uid: true },
          )) {
            if (!message.source) continue;
            const parsed = await simpleParser(message.source, { skipTextToHtml: true });
            const precedence = String(parsed.headers.get('precedence') ?? '').toLowerCase();
            const autoSubmitted = String(parsed.headers.get('auto-submitted') ?? '').toLowerCase();
            previews.set(message.uid, {
              mailingList: parsed.headers.has('list-id') || parsed.headers.has('list-unsubscribe'),
              automated:
                ['bulk', 'list', 'junk'].includes(precedence) ||
                (Boolean(autoSubmitted) && autoSubmitted !== 'no'),
              text: previewText(parsed.text),
            });
          }
        } finally {
          lock.release();
        }
      },
      60_000,
      'background',
    );
  } catch {
    // Classification still works from sender and subject; fall back to cached bodies.
  }
  for (const uid of uids) {
    if (previews.has(uid)) continue;
    const body = mailCache().getMessageBody(account.id, folderPath, uid);
    if (body) previews.set(uid, { mailingList: false, automated: false, text: previewText(body.text) });
  }
  return previews;
}

function formatAddress(address: MailAddressSummary | undefined): string {
  if (!address) return 'Unknown';
  return address.name && address.address
    ? `${address.name} <${address.address}>`
    : address.address ?? address.name ?? 'Unknown';
}

function messageState(
  account: StoredAccount,
  candidate: InsightCandidate,
  preview: MessagePreview | undefined,
): Record<string, unknown> {
  return {
    from: formatAddress(candidate.from[0]),
    to: candidate.to.slice(0, 5).map(formatAddress).join(', ') || account.email,
    recipient_account: account.email,
    subject: candidate.subject,
    ...(preview
      ? {
          sent_to_mailing_list: preview.mailingList,
          automated_sender: preview.automated,
          body_preview: preview.text,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Classification run

let generation = 0;
let activeRun: Promise<void> | null = null;
let rerunRequested = false;
let scheduleTimer: NodeJS.Timeout | null = null;

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  }));
}

async function classifyAccount(
  account: StoredAccount,
  settings: SmartInboxSettings,
  apiKey: string,
  runGeneration: number,
): Promise<{ classified: number; failed: number }> {
  const inbox = findInboxFolder(mailCache().listFolders(account.id));
  if (!inbox) return { classified: 0, failed: 0 };
  const inboxIds = settings.inboxes.map(({ id }) => id);
  const candidates = mailCache().insightCandidates(
    account.id,
    inbox.path,
    inboxIds,
    INSIGHTS_RECENT_MESSAGE_LIMIT,
  );
  if (candidates.length === 0) return { classified: 0, failed: 0 };

  const previews = await fetchPreviews(account, inbox.path, candidates.map(({ uid }) => uid));
  const rulesById = new Map(settings.inboxes.map((smartInbox) => [smartInbox.id, smartInbox.rule]));
  let classified = 0;
  let failed = 0;
  let unpublished = 0;
  await mapWithConcurrency(candidates, REQUEST_CONCURRENCY, async (candidate) => {
    if (runGeneration !== generation) return;
    const questions: Record<string, unknown> = candidate.needsBaseInsights
      ? { ...BASE_INSIGHT_QUESTIONS }
      : {};
    for (const inboxId of candidate.missingInboxIds) {
      questions[`${RULE_QUESTION_PREFIX}${inboxId}`] = smartInboxRuleQuestion(rulesById.get(inboxId)!);
    }
    try {
      const answers = await askJev(
        apiKey,
        messageState(account, candidate, previews.get(candidate.uid)),
        questions,
      );
      if (runGeneration !== generation) return;
      const base = candidate.needsBaseInsights ? baseInsights(answers) : null;
      if (candidate.needsBaseInsights && !base) {
        failed += 1;
        return;
      }
      const ruleScores = Object.fromEntries(candidate.missingInboxIds.flatMap((inboxId) => {
        const score = probability(answers[`${RULE_QUESTION_PREFIX}${inboxId}`]);
        return score === null ? [] : [[inboxId, score]];
      }));
      mailCache().putMessageInsights(
        account.id,
        inbox.path,
        candidate.uid,
        candidate.messageId,
        base,
        ruleScores,
      );
      classified += 1;
      unpublished += 1;
      if (unpublished >= PUBLISH_EVERY) {
        unpublished = 0;
        publishMailboxChanged();
      }
    } catch (error) {
      if (error instanceof JevRequestError && error.fatal) throw error;
      failed += 1;
    }
  });
  return { classified, failed };
}

async function classifyAll(): Promise<void> {
  const runGeneration = generation;
  const settings = await readSmartInboxSettings();
  if (!settings.enabled) {
    setStatus({ state: 'idle' });
    return;
  }
  const apiKey = await readOpenRouterApiKey();
  if (!apiKey) {
    setStatus({
      state: 'error',
      message: 'Smart inboxes need OpenRouter as the AI provider in Settings → AI assistant.',
    });
    return;
  }
  setStatus({ state: 'running' });
  mailCache().pruneInsights();
  let classified = 0;
  let failed = 0;
  try {
    for (const account of await readAccounts()) {
      if (runGeneration !== generation) return;
      const result = await classifyAccount(account, settings, apiKey, runGeneration);
      classified += result.classified;
      failed += result.failed;
      if (result.classified > 0) publishMailboxChanged();
    }
    setStatus(failed > 0 && classified === 0
      ? { state: 'error', message: 'Could not classify new mail. Emzero will retry on the next sync.' }
      : { state: 'idle' });
  } catch (error) {
    if (classified > 0) publishMailboxChanged();
    setStatus({
      state: 'error',
      message: error instanceof JevRequestError
        ? error.message
        : 'Could not reach OpenRouter to classify new mail.',
    });
  }
}

function runMailInsights(): void {
  if (activeRun) {
    rerunRequested = true;
    return;
  }
  activeRun = (async () => {
    do {
      rerunRequested = false;
      await classifyAll();
    } while (rerunRequested);
  })()
    .catch(() => setStatus({ state: 'error', message: 'Could not classify new mail.' }))
    .finally(() => {
      activeRun = null;
    });
}

/** Classify new Inbox mail soon. Cheap to call often: it only reads the cache when nothing is new. */
export function scheduleMailInsights(delay = 1_500): void {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    runMailInsights();
  }, delay);
}

function restartMailInsights(): void {
  generation += 1;
  rerunRequested = Boolean(activeRun);
  scheduleMailInsights(300);
}

// ---------------------------------------------------------------------------
// Settings operations

async function unreadCounts(): Promise<Record<string, number>> {
  const settings = await readSmartInboxSettings();
  const counts: Record<string, number> = Object.fromEntries(
    settings.inboxes.map(({ id }) => [id, 0]),
  );
  if (!settings.enabled || settings.inboxes.length === 0) return counts;
  for (const account of await readAccounts()) {
    const inbox = findInboxFolder(mailCache().listFolders(account.id));
    if (!inbox) continue;
    for (const message of mailCache().listMessages(account.id, inbox.path).messages) {
      if (!message.unread) continue;
      for (const smartInbox of settings.inboxes) {
        if (smartInboxContains(smartInbox, message)) counts[smartInbox.id] += 1;
      }
    }
  }
  return counts;
}

function normalizedDraft(value: SmartInboxDraft): SmartInboxDraft {
  return { name: value.name.trim(), rule: value.rule.trim(), skipInbox: value.skipInbox };
}

export function registerSmartInboxHandlers(
  isTrustedSender: (event: Electron.IpcMainInvokeEvent) => boolean,
): void {
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
  };

  ipcMain.handle(SMART_INBOX_CHANNELS.getSettings, async (event) => {
    trusted(event);
    return readSmartInboxSettings();
  });

  ipcMain.handle(SMART_INBOX_CHANNELS.status, (event) => {
    trusted(event);
    return status;
  });

  ipcMain.handle(SMART_INBOX_CHANNELS.unreadCounts, async (event) => {
    trusted(event);
    return unreadCounts();
  });

  ipcMain.handle(SMART_INBOX_CHANNELS.setEnabled, async (event, enabled: unknown) => {
    trusted(event);
    if (typeof enabled !== 'boolean') return { ok: false, message: 'Invalid setting.' };
    const result = await updateSmartInboxSettings((settings) => ({ ...settings, enabled }));
    if (result.ok) {
      // Turning the feature off also forgets every classification made so far.
      if (!enabled) mailCache().clearInsights();
      restartMailInsights();
      publishChanged();
      publishMailboxChanged();
    }
    return result;
  });

  ipcMain.handle(SMART_INBOX_CHANNELS.create, async (event, value: unknown) => {
    trusted(event);
    const error = validateSmartInboxDraft(value);
    if (error) return { ok: false, message: error };
    const draft = normalizedDraft(value as SmartInboxDraft);
    const result = await updateSmartInboxSettings((settings) =>
      settings.inboxes.length >= MAX_SMART_INBOXES
        ? `You can create up to ${MAX_SMART_INBOXES} smart inboxes.`
        : {
            enabled: true,
            inboxes: [
              ...settings.inboxes,
              { id: randomUUID(), ...draft, excludedSenders: [], createdAt: new Date().toISOString() },
            ],
          });
    if (result.ok) {
      restartMailInsights();
      publishChanged();
    }
    return result;
  });

  ipcMain.handle(SMART_INBOX_CHANNELS.update, async (event, inboxId: unknown, value: unknown) => {
    trusted(event);
    const error = validateSmartInboxDraft(value);
    if (error) return { ok: false, message: error };
    if (typeof inboxId !== 'string') return { ok: false, message: 'Smart inbox not found.' };
    const draft = normalizedDraft(value as SmartInboxDraft);
    let ruleChanged = false;
    const result = await updateSmartInboxSettings((settings) => {
      const current = settings.inboxes.find(({ id }) => id === inboxId);
      if (!current) return 'Smart inbox not found.';
      ruleChanged = current.rule !== draft.rule;
      return {
        ...settings,
        inboxes: settings.inboxes.map((smartInbox) =>
          smartInbox.id === inboxId ? { ...smartInbox, ...draft } : smartInbox),
      };
    });
    if (result.ok) {
      if (ruleChanged) {
        mailCache().deleteSmartInboxScores(inboxId);
        restartMailInsights();
      }
      publishChanged();
      publishMailboxChanged();
    }
    return result;
  });

  ipcMain.handle(SMART_INBOX_CHANNELS.remove, async (event, inboxId: unknown) => {
    trusted(event);
    if (typeof inboxId !== 'string') return { ok: false, message: 'Smart inbox not found.' };
    const result = await updateSmartInboxSettings((settings) => ({
      ...settings,
      inboxes: settings.inboxes.filter(({ id }) => id !== inboxId),
    }));
    if (result.ok) {
      mailCache().deleteSmartInboxScores(inboxId);
      publishChanged();
      publishMailboxChanged();
    }
    return result;
  });

  ipcMain.handle(
    SMART_INBOX_CHANNELS.excludeSender,
    async (event, inboxId: unknown, address: unknown) => {
      trusted(event);
      if (typeof inboxId !== 'string' || typeof address !== 'string' || !address.trim() || address.length > 320) {
        return { ok: false, message: 'Invalid sender.' };
      }
      const sender = address.trim().toLowerCase();
      const result = await updateSmartInboxSettings((settings) => {
        if (!settings.inboxes.some(({ id }) => id === inboxId)) return 'Smart inbox not found.';
        return {
          ...settings,
          inboxes: settings.inboxes.map((smartInbox) =>
            smartInbox.id === inboxId && !smartInbox.excludedSenders.includes(sender)
              ? { ...smartInbox, excludedSenders: [...smartInbox.excludedSenders, sender] }
              : smartInbox),
        };
      });
      if (result.ok) {
        publishChanged();
        publishMailboxChanged();
      }
      return result;
    },
  );
}
