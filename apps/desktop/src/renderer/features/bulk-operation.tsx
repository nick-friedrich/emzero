import {
  Archive,
  CheckCircle2,
  CircleAlert,
  Folder,
  Mail,
  MailOpen,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import {
  cn,
} from '@/lib/utils';
import {
  type BulkMessageJobProgress,
  type BulkMessageJobRequest,
} from '../../shared/accounts';

export interface BulkOperationView {
  location: string;
  request: BulkMessageJobRequest;
  progress: BulkMessageJobProgress;
  processedKeys: ReadonlySet<string>;
}

export function BulkOperationBar({
  operation,
  onStop,
  onRetry,
  onDismiss,
}: {
  operation: BulkOperationView;
  onStop: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { progress, location } = operation;
  const terminal = ['completed', 'stopped', 'error'].includes(progress.state);
  const verb =
    progress.action === 'read'
      ? 'mark as read'
      : progress.action === 'unread'
        ? 'mark as unread'
        : progress.action === 'star'
          ? 'star'
          : progress.action === 'unstar'
            ? 'unstar'
        : progress.action === 'archive'
          ? 'archive'
          : progress.action === 'move'
            ? 'move'
        : 'delete';
  const presentVerb =
    progress.action === 'read'
      ? 'Marking emails as read'
      : progress.action === 'unread'
        ? 'Marking emails as unread'
        : progress.action === 'star'
          ? 'Starring emails'
          : progress.action === 'unstar'
            ? 'Removing stars'
        : progress.action === 'archive'
          ? 'Archiving emails'
          : progress.action === 'move'
            ? 'Moving emails'
        : 'Deleting emails';
  const title =
    progress.state === 'completed'
      ? `${progress.total} ${progress.total === 1 ? 'email' : 'emails'} ${verb === 'delete' ? 'deleted' : progress.action === 'read' ? 'marked as read' : progress.action === 'unread' ? 'marked as unread' : progress.action === 'star' ? 'starred' : progress.action === 'unstar' ? 'unstarred' : progress.action === 'archive' ? 'archived' : 'moved'}`
      : progress.state === 'stopped'
        ? `Stopped after ${progress.processed} of ${progress.total}`
        : progress.state === 'error'
          ? `Stopped after ${progress.processed} of ${progress.total}`
          : `${presentVerb} in ${location}`;
  const percentage = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 py-3 shadow-[0_-8px_24px_-18px_rgba(0,0,0,0.5)] lg:left-60" aria-live="polite" aria-label="Mail operation status">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
          {progress.state === 'completed' ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : progress.state === 'error' ? (
            <CircleAlert className="size-4 text-danger" />
          ) : progress.state === 'stopped' ? (
            <XCircle className="size-4 text-muted-foreground" />
          ) : progress.action === 'delete' ? (
            <Trash2 className="size-4" />
          ) : progress.action === 'archive' ? (
            <Archive className="size-4" />
          ) : progress.action === 'move' ? (
            <Folder className="size-4" />
          ) : progress.action === 'read' ? (
            <MailOpen className="size-4" />
          ) : progress.action === 'star' || progress.action === 'unstar' ? (
            <Star className="size-4" />
          ) : (
            <Mail className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="truncate font-medium">{title}</p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {progress.processed}/{progress.total}
            </span>
          </div>
          {!terminal && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${percentage}%` }}
              />
            </div>
          )}
          <p className={cn('mt-1 truncate text-xs', progress.state === 'error' ? 'text-danger' : 'text-muted-foreground')}>
            {progress.state === 'running'
              ? 'You can continue using Emzero while this runs.'
              : progress.state === 'stopping'
                ? 'Stopping after the current batch…'
                : progress.message ?? (progress.state === 'stopped' ? 'Completed changes were kept.' : `Finished in ${location}.`)}
          </p>
        </div>
        {progress.state === 'running' && (
          <Button variant="secondary" className="shrink-0" onClick={onStop}>Stop</Button>
        )}
        {progress.state === 'stopping' && (
          <Button variant="secondary" className="shrink-0" disabled>Stopping…</Button>
        )}
        {(progress.state === 'stopped' || progress.state === 'error') && progress.processed < progress.total && (
          <Button variant="secondary" className="shrink-0" onClick={onRetry}>
            {progress.state === 'stopped' ? 'Resume remaining' : 'Retry remaining'}
          </Button>
        )}
        {terminal && (
          <Button variant="ghost" className="size-9 shrink-0 px-0" aria-label="Dismiss operation status" onClick={onDismiss}>
            <XCircle className="size-4" />
          </Button>
        )}
      </div>
    </aside>
  );
}
