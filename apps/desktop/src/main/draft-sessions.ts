import type { MailDraftReference, MailSendDraft } from '../shared/accounts.js';
import type { StoredAccount } from './account-storage.js';
import { deleteMailDraft, saveMailDraft } from './mail-drafts.js';

/**
 * The saved copy of one message being composed, keyed by a composer-generated id that
 * travels with it when the composer pops out into its own window or is sent. Operations
 * on a key run one after another, so a save still uploading when the composer hands off
 * finishes before the next owner's save, which then replaces that copy rather than
 * leaving a duplicate in Drafts.
 */
interface DraftSession {
  accountId?: string;
  reference?: MailDraftReference;
  queue: Promise<unknown>;
}

const sessions = new Map<string, DraftSession>();

export function validDraftSessionKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{8,64}$/i.test(value);
}

function run<T>(key: string, operation: (session: DraftSession) => Promise<T>): Promise<T> {
  let session = sessions.get(key);
  if (!session) {
    session = { queue: Promise.resolve() };
    sessions.set(key, session);
  }
  const current = session;
  const result = current.queue.catch(() => undefined).then(() => operation(current));
  current.queue = result;
  return result;
}

// The session's copy is newer than any reference a caller holds once a handed-off save lands.
function latestReference(
  session: DraftSession,
  accountId: string,
  known: MailDraftReference | undefined,
): MailDraftReference | undefined {
  return session.accountId === accountId && session.reference ? session.reference : known;
}

export function saveSessionDraft(
  key: string,
  account: StoredAccount,
  draft: MailSendDraft,
  previous: MailDraftReference | undefined,
) {
  return run(key, async (session) => {
    const result = await saveMailDraft(account, draft, latestReference(session, account.id, previous));
    if (result.ok && result.draft) {
      session.accountId = account.id;
      session.reference = result.draft;
    }
    return result;
  });
}

export function deleteSessionDraft(key: string, account: StoredAccount, known: MailDraftReference) {
  return run(key, async (session) => {
    const reference = latestReference(session, account.id, known) ?? known;
    const result = await deleteMailDraft(account, reference);
    if (result.ok) sessions.delete(key);
    return result;
  });
}

/** After a message is sent: removes the copy it was composed in. */
export function finishSessionDraft(
  key: string | undefined,
  account: StoredAccount,
  known: MailDraftReference | undefined,
): Promise<unknown> {
  if (!key) return known ? deleteMailDraft(account, known) : Promise.resolve();
  return run(key, async (session) => {
    const reference = latestReference(session, account.id, known);
    if (reference) await deleteMailDraft(account, reference);
    sessions.delete(key);
  });
}

/** After sending fails: writes the message over the copy it was composed in. */
export function keepSessionDraft(
  key: string | undefined,
  account: StoredAccount,
  draft: MailSendDraft,
  known: MailDraftReference | undefined,
) {
  if (!key) return saveMailDraft(account, draft, known);
  return saveSessionDraft(key, account, draft, known);
}
