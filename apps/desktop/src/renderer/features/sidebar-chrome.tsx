import { PanelLeftClose, PanelLeftOpen, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MailSyncStatus } from '../../shared/accounts';
import { messageDate } from './mail-common';

/** Demo badge and the collapse toggle. Demo mode itself is switched in Settings. */
export function SidebarBrand({
  demoMode,
  pinned,
  onPinnedChange,
}: {
  demoMode: boolean;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}) {
  const showToggle = Boolean(onPinnedChange) && pinned !== undefined;
  if (!demoMode && !showToggle) return null;
  return (
    <div className="mb-3 flex shrink-0 items-center gap-2.5 px-1">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {demoMode && (
          <span
            className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
            title="Sample mailbox. Your own accounts are not loaded."
          >
            Demo
          </span>
        )}
      </div>
      {onPinnedChange && pinned !== undefined && (
        <Button
          variant="ghost"
          className="size-8 shrink-0 px-0 text-muted-foreground hover:text-foreground"
          aria-label={pinned ? 'Collapse sidebar' : 'Expand sidebar'}
          title={`${pinned ? 'Collapse' : 'Expand'} sidebar (${window.emzero?.platform === 'darwin' ? '⌘B' : 'Ctrl+B'})`}
          onClick={() => onPinnedChange(!pinned)}
        >
          {pinned
            ? <PanelLeftClose className="size-4" />
            : <PanelLeftOpen className="size-4" />}
        </Button>
      )}
    </div>
  );
}

/** Sync and Settings, shared wording for the expanded sidebar and the collapsed rail. */
export function syncStatusLabel(syncStatus: MailSyncStatus): string {
  if (syncStatus.state === 'syncing') return 'Syncing mail';
  if (syncStatus.state === 'error') return 'Sync needs attention';
  return syncStatus.lastSyncedAt ? `Synced ${messageDate(syncStatus.lastSyncedAt)}` : 'Sync mail';
}

/** Sync now (with status) above Settings, matching the collapsed rail's footer. */
export function SidebarFooter({
  syncStatus,
  hasAccounts,
  onManage,
}: {
  syncStatus: MailSyncStatus;
  hasAccounts: boolean;
  onManage: () => void;
}) {
  const syncing = syncStatus.state === 'syncing';
  const failed = syncStatus.state === 'error';
  const row = 'h-9 w-full justify-start gap-2.5 rounded-xl px-3 text-[13px] text-muted-foreground hover:text-foreground';
  return (
    <div className="mt-3 shrink-0 space-y-0.5 border-t border-border/60 pt-2">
      <Button
        variant="ghost"
        className={cn(row, failed && 'text-danger hover:text-danger')}
        disabled={syncing || !hasAccounts}
        title={syncStatus.message ?? 'Sync all accounts now'}
        onClick={() => void window.emzero.sync.now()}
      >
        <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
        <span className="min-w-0 flex-1 truncate text-left">{syncStatusLabel(syncStatus)}</span>
      </Button>
      <Button variant="ghost" className={row} onClick={onManage}>
        <Settings2 className="size-4" />
        Settings
      </Button>
    </div>
  );
}
