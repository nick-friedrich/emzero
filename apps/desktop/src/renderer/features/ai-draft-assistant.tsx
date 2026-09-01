import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AiDraftMessageResult } from '../../shared/ai';

export function AiDraftAssistant({
  disabled = false,
  className,
  actionLabel,
  placeholder,
  privacyDescription,
  onGenerate,
  onApply,
  onBusyChange,
}: {
  disabled?: boolean;
  className?: string;
  actionLabel: string;
  placeholder: string;
  privacyDescription: string;
  onGenerate: (instruction: string) => Promise<AiDraftMessageResult>;
  onApply: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
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
    onBusyChange?.(true);
    setStatus(null);
    try {
      const result = await onGenerate(instruction.trim());
      if (!result.ok || !result.text) {
        setStatus({ kind: 'error', message: result.message ?? 'Could not draft this email.' });
        return;
      }
      onApply(result.text.trim());
      setStatus({ kind: 'success', message: 'AI draft added. Review it before sending.' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not draft this email.',
      });
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <section
      className={cn('rounded-lg border border-border bg-secondary/50 p-3', className)}
      aria-label="AI email drafting"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <Sparkles className="size-4 text-primary" />
        Draft with AI
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
          {actionLabel}
        </Button>
      </div>
      <p className="mt-2 text-[0.68rem] text-muted-foreground">{privacyDescription}</p>
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
