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
): {
  status: DraftAutosaveState;
  discardSavedDraft: () => Promise<void>;
} {
  const [status, setStatus] = useState<DraftAutosaveState>({ state: 'idle' });
  const savedDraft = useRef<{ accountId: string; reference: MailDraftReference } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const fingerprint = useMemo(() => JSON.stringify(draft), [draft]);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (!accountId || !enabled) return;
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
    savedDraft.current = null;
    setStatus({ state: 'idle' });
    if (saved) await window.emzero.messages.deleteDraft(saved.accountId, saved.reference);
  }, []);

  return { status, discardSavedDraft };
}
