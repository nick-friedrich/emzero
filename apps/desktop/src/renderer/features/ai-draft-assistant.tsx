import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AiDraftMessageResult } from '../../shared/ai';

export function AiDraftAssistant({
  disabled = false,
  className,
  currentText,
  actionLabel,
  placeholder,
  privacyDescription,
  onGenerate,
  onApply,
  onBusyChange,
}: {
  disabled?: boolean;
  className?: string;
  currentText: string;
  actionLabel: string;
  placeholder: string;
  privacyDescription: string;
  onGenerate: (
    instruction: string,
    onProgress: (text: string) => void,
  ) => Promise<AiDraftMessageResult>;
  onApply: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [history, setHistory] = useState<{ text: string; generated: boolean }[]>([]);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const refresh = () => {
      void window.emzero.ai.getSettings()
        .then((settings) => setConfigured(settings.configured))
        .catch(() => setConfigured(false));
    };
    refresh();
    const channel = new BroadcastChannel('emzero-settings-events');
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'ai-settings-changed') refresh();
    });
    return () => channel.close();
  }, []);

  if (!configured) return null;

  const generate = async () => {
    if (!instruction.trim()) return;
    setBusy(true);
    setStreamStarted(false);
    onBusyChange?.(true);
    setStatus(null);
    let previousRecorded = false;
    const applyGeneratedText = (text: string) => {
      if (!previousRecorded) {
        previousRecorded = true;
        setHistory((current) => [...current, { text: currentText, generated }].slice(-10));
      }
      setStreamStarted(true);
      onApply(text);
    };
    try {
      const result = await onGenerate(instruction.trim(), applyGeneratedText);
      if (!result.ok || !result.text) {
        if (previousRecorded) setGenerated(true);
        setStatus({
          kind: 'error',
          message: previousRecorded
            ? `${result.message ?? 'The response stopped early.'} The partial draft was kept; you can undo it.`
            : (result.message ?? 'Could not draft this email.'),
        });
        return;
      }
      if (!previousRecorded) applyGeneratedText(result.text.trim());
      else onApply(result.text.trim());
      setGenerated(true);
      setInstruction('');
      setStatus({
        kind: 'success',
        message: 'Draft ready. Describe any changes above to refine it, or undo to restore the previous version.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not draft this email.';
      if (previousRecorded) setGenerated(true);
      setStatus({
        kind: 'error',
        message: previousRecorded
          ? `${message} The partial draft was kept; you can undo it.`
          : message,
      });
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const rollback = () => {
    const previous = history.at(-1);
    if (!previous) return;
    onApply(previous.text);
    setGenerated(previous.generated);
    setHistory((current) => current.slice(0, -1));
    setStatus({ kind: 'success', message: 'Previous draft restored.' });
  };

  return (
    <section
      className={cn('rounded-lg border border-border bg-secondary/50 p-3', className)}
      aria-label="AI email drafting"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <Sparkles className="size-4 text-primary" />
        {generated ? 'Refine with AI' : 'Draft with AI'}
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Instructions for AI draft</span>
          <textarea
            className="field min-h-20 resize-y text-sm leading-5"
            value={instruction}
            maxLength={4_000}
            placeholder={placeholder}
            disabled={disabled || busy}
            onChange={(event) => {
              setInstruction(event.target.value);
              setStatus(null);
            }}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || busy || !instruction.trim()}
          onClick={() => void generate()}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {busy ? (streamStarted ? 'Writing…' : 'Thinking…') : (generated ? 'Refine draft' : actionLabel)}
        </Button>
      </div>
      {busy && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          <span>{streamStarted ? 'Writing your draft' : 'Thinking'}</span>
          <span className="flex gap-1" aria-hidden="true">
            <span className="size-1.5 animate-bounce rounded-full bg-current" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
          </span>
        </div>
      )}
      <p className="mt-2 text-[0.68rem] text-muted-foreground">{privacyDescription}</p>
      {history.length > 0 && !busy && (
        <Button type="button" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={rollback}>
          <Undo2 className="size-3.5" />
          Restore previous draft
        </Button>
      )}
      {status && (
        <p
          className={cn('mt-2 text-xs', status.kind === 'success' ? 'text-success' : 'text-danger')}
          role="status"
        >
          {status.message}
        </p>
      )}
    </section>
  );
}
