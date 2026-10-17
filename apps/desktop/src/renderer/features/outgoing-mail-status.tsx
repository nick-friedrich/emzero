import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MailSendJob } from '../../shared/accounts';

const sentVisibleMs = 4_000;

/**
 * Status cards for messages delivering in the background. Composers close as soon as a
 * message is queued, so this is where sending progress, success, and failures (with Retry)
 * appear. Every window receives send updates; only the main window renders this.
 */
export function OutgoingMailStatus({
  raised,
  onFinished,
}: {
  /** Lift the cards above the bulk-operation bar while it is showing. */
  raised: boolean;
  onFinished: (job: MailSendJob) => void;
}) {
  const [jobs, setJobs] = useState<MailSendJob[]>([]);

  useEffect(() => window.emzero.messages.onSendJob((job) => {
    setJobs((current) => [...current.filter((candidate) => candidate.jobId !== job.jobId), job]);
    if (job.state !== 'sending') onFinished(job);
    if (job.state === 'sent') {
      window.setTimeout(() => {
        setJobs((current) => current.filter((candidate) =>
          candidate.jobId !== job.jobId || candidate.state !== 'sent'));
      }, sentVisibleMs);
    }
  }), [onFinished]);

  if (jobs.length === 0) return null;

  const dismiss = (job: MailSendJob) => {
    setJobs((current) => current.filter((candidate) => candidate.jobId !== job.jobId));
    if (job.state === 'failed') void window.emzero.messages.dismissSend(job.jobId);
  };

  const retry = async (job: MailSendJob) => {
    const result = await window.emzero.messages.retrySend(job.jobId).catch(() => null);
    if (!result?.ok) {
      setJobs((current) => current.map((candidate) => candidate.jobId === job.jobId
        ? { ...candidate, message: result?.message ?? 'Could not retry sending.' }
        : candidate));
    }
  };

  return (
    <div
      className={cn(
        'pointer-events-none fixed right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2',
        raised ? 'bottom-24' : 'bottom-4',
      )}
      aria-live="polite"
      aria-label="Sending status"
    >
      {jobs.map((job) => {
        const label = job.kind === 'reply' ? 'reply' : 'message';
        const subject = job.subject || '(no subject)';
        return (
          <div
            key={job.jobId}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)]"
            role={job.state === 'failed' ? 'alert' : 'status'}
          >
            <div className="mt-0.5 shrink-0">
              {job.state === 'sending' ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              ) : job.state === 'sent' ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <CircleAlert className="size-4 text-danger" />
              )}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">
                {job.state === 'sending'
                  ? `Sending ${label}…`
                  : job.state === 'sent'
                    ? `${job.kind === 'reply' ? 'Reply' : 'Message'} sent`
                    : `Couldn't send ${label}`}
              </p>
              <p className="truncate text-xs text-muted-foreground">{subject}</p>
              {job.state === 'failed' && job.message && (
                <p className="mt-1 line-clamp-3 text-xs text-danger">{job.message}</p>
              )}
            </div>
            {job.state === 'failed' && (
              <Button variant="secondary" className="h-7 shrink-0 px-2 text-xs" onClick={() => void retry(job)}>
                Retry
              </Button>
            )}
            {job.state !== 'sending' && (
              <Button
                variant="ghost"
                className="size-7 shrink-0 px-0"
                aria-label="Dismiss sending status"
                onClick={() => dismiss(job)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
