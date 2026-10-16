import { useRef, type CSSProperties } from 'react';
import { LogOut, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailSyncStatus } from '../../shared/accounts';
import emzeroLogoUrl from '../../../assets/emzero-logo-header.webp';
import { messageDate } from './mail-common';

/** Logo (five quick clicks toggle demo mode), app name, demo badge, and the pin toggle. */
export function SidebarBrand({
  demoMode,
  onDemoModeChange,
  pinned,
  onPinnedChange,
}: {
  demoMode: boolean;
  onDemoModeChange: (enabled: boolean) => void;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}) {
  const demoClickTimes = useRef<number[]>([]);
  const logoStyle = {
    '--emzero-logo-mask': `url("${emzeroLogoUrl}")`,
  } as CSSProperties;

  return (
    <div className="mb-5 flex shrink-0 items-center gap-2.5 px-2">
      <button
        type="button"
        className="emzero-logo size-7 shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={logoStyle}
        aria-label="Emzero"
        onClick={() => {
          const now = Date.now();
          const recentClicks = demoClickTimes.current.filter(
            (clickedAt) => now - clickedAt < 2_000,
          );
          recentClicks.push(now);
          demoClickTimes.current = recentClicks;
          if (recentClicks.length >= 5) {
            demoClickTimes.current = [];
            onDemoModeChange(!demoMode);
          }
        }}
      >
        <img
          src={emzeroLogoUrl}
          alt=""
          width={192}
          height={192}
          draggable={false}
          className="size-full object-contain"
        />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p className="font-semibold tracking-tight">Emzero</p>
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
          className="size-8 shrink-0 px-0"
          aria-label={pinned ? 'Unpin navigation' : 'Pin navigation'}
          title={pinned ? 'Unpin navigation' : 'Keep navigation open'}
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

/** Sync status, Settings, and Add account / Exit demo mode actions. */
export function SidebarFooter({
  syncStatus,
  hasAccounts,
  demoMode,
  onManage,
  onAdd,
  onDemoModeChange,
}: {
  syncStatus: MailSyncStatus;
  hasAccounts: boolean;
  demoMode: boolean;
  onManage: () => void;
  onAdd: () => void;
  onDemoModeChange: (enabled: boolean) => void;
}) {
  return (
    <div className="mt-3 shrink-0 border-t border-border/60 pt-2">
      <Button
        variant="ghost"
        className="mb-0.5 h-8 w-full justify-start text-xs text-muted-foreground"
        disabled={syncStatus.state === 'syncing' || !hasAccounts}
        title={syncStatus.message}
        onClick={() => void window.emzero.sync.now()}
      >
        <RefreshCw
          className={`size-4 ${syncStatus.state === 'syncing' ? 'animate-spin' : ''}`}
        />
        {syncStatus.state === 'syncing'
          ? 'Syncing mail'
          : syncStatus.state === 'error'
            ? 'Sync needs attention'
            : syncStatus.lastSyncedAt
              ? `Synced ${messageDate(syncStatus.lastSyncedAt)}`
              : 'Sync mail'}
      </Button>
      <Button
        variant="ghost"
        className="mb-0.5 h-8 w-full justify-start text-xs text-muted-foreground"
        onClick={onManage}
      >
        <Settings2 className="size-4" />
        Settings
      </Button>
      {demoMode ? (
        <Button
          variant="ghost"
          className="h-8 w-full justify-start text-xs text-muted-foreground"
          title="Restart Emzero with your own accounts"
          onClick={() => onDemoModeChange(false)}
        >
          <LogOut className="size-4" />
          Exit demo mode
        </Button>
      ) : (
        <Button
          variant="ghost"
          className="h-8 w-full justify-start text-xs text-muted-foreground"
          onClick={onAdd}
        >
          <Plus className="size-4" />
          Add account
        </Button>
      )}
    </div>
  );
}
