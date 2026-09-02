import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MailDraftReference, MailSendDraft } from '../../shared/accounts';

export type DraftAutosaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string };

export function useDraftAutosave(
  accountId: string,
  draft: MailSendDraft,
  enabled: boolean,
  initialReference?: MailDraftReference,
): {
  status: DraftAutosaveState;
  savedDraftReference: MailDraftReference | undefined;
  handoffSavedDraft: () => Promise<MailDraftReference | undefined>;
  discardSavedDraft: () => Promise<boolean>;
} {
  const [status, setStatus] = useState<DraftAutosaveState>({ state: 'idle' });
  const [savedDraftReference, setSavedDraftReference] = useState(initialReference);
  const savedDraft = useRef<{ accountId: string; reference: MailDraftReference } | null>(
    initialReference ? { accountId, reference: initialReference } : null,
  );
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const fingerprint = useMemo(() => JSON.stringify(draft), [draft]);
  const lastSavedFingerprint = useRef<string | null>(initialReference ? fingerprint : null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (!accountId || !enabled) return;
    if (lastSavedFingerprint.current === fingerprint) return;
    const saveGeneration = generation.current;
    const snapshot = JSON.parse(fingerprint) as MailSendDraft;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setStatus({ state: 'saving' });
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (generation.current !== saveGeneration) return;
          const previous =
            savedDraft.current?.accountId === accountId
              ? savedDraft.current.reference
              : undefined;
          const result = await window.emzero.messages.saveDraft(accountId, snapshot, previous);
          if (!result.ok || !result.draft) {
            if (generation.current !== saveGeneration) return;
            setStatus({ state: 'error', message: result.message ?? 'Could not save draft.' });
            return;
          }
          savedDraft.current = { accountId, reference: result.draft };
          lastSavedFingerprint.current = fingerprint;
          setSavedDraftReference(result.draft);
          if (generation.current !== saveGeneration) return;
          setStatus({ state: 'saved', message: result.message ?? 'Draft saved.' });
        });
    }, 1_200);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [accountId, enabled, fingerprint]);

  const discardSavedDraft = useCallback(async () => {
    generation.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    await queue.current.catch(() => undefined);
    const saved = savedDraft.current;
    if (saved) {
      const result = await window.emzero.messages.deleteDraft(saved.accountId, saved.reference);
      if (!result.ok) {
        setStatus({ state: 'error', message: result.message ?? 'Could not delete draft.' });
        return false;
      }
    }
    savedDraft.current = null;
    lastSavedFingerprint.current = null;
    setSavedDraftReference(undefined);
    setStatus({ state: 'idle' });
    return true;
  }, []);

  const handoffSavedDraft = useCallback(async () => {
    let saveFailed = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (accountId && enabled && lastSavedFingerprint.current !== fingerprint) {
      const saveGeneration = generation.current;
      const snapshot = JSON.parse(JSON.stringify(draft)) as MailSendDraft;
      setStatus({ state: 'saving' });
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (generation.current !== saveGeneration) return;
          const previous = savedDraft.current?.accountId === accountId
            ? savedDraft.current.reference
            : undefined;
          const result = await window.emzero.messages.saveDraft(accountId, snapshot, previous);
          if (!result.ok || !result.draft) {
            saveFailed = true;
            if (generation.current === saveGeneration) {
              setStatus({ state: 'error', message: result.message ?? 'Could not save draft.' });
            }
            return;
          }
          savedDraft.current = { accountId, reference: result.draft };
          lastSavedFingerprint.current = fingerprint;
          setSavedDraftReference(result.draft);
          if (generation.current === saveGeneration) {
            setStatus({ state: 'saved', message: result.message ?? 'Draft saved.' });
          }
        });
    }
    await queue.current.catch(() => undefined);
    return saveFailed ? undefined : savedDraft.current?.reference;
  }, [accountId, draft, enabled, fingerprint]);

  return { status, savedDraftReference, handoffSavedDraft, discardSavedDraft };
}
