import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CircleAlert,
  FileText,
  Inbox,
  LoaderCircle,
  PanelLeftOpen,
  PenLine,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type AccountSummary,
  type MailFolderSummary,
  type MailSyncStatus,
  accountUnreadCount,
  displayFolderName,
  inboxUnreadCount,
  visibleFolderTree,
} from '../../shared/accounts';
import { accountColorDotClass } from './account-colors';
import {
  FolderIcon,
  UnreadBadge,
  type FolderLoadState,
  type MailboxSelection,
} from './mail-common';
import { syncStatusLabel } from './sidebar-chrome';
import { SmartInboxIcon, useSmartInboxes, useSmartInboxUnreadCounts } from './smart-inboxes';

type UnifiedMailbox = 'inbox' | 'starred' | 'drafts' | 'trash';

const mailboxes: readonly { mailbox: UnifiedMailbox; label: string; icon: typeof Inbox }[] = [
  { mailbox: 'inbox', label: 'Inbox', icon: Inbox },
  { mailbox: 'starred', label: 'Starred', icon: Star },
  { mailbox: 'drafts', label: 'Drafts', icon: FileText },
  { mailbox: 'trash', label: 'Trash', icon: Trash2 },
];

type HoverLabelControls = {
  show: (text: string, element: HTMLElement) => void;
  hide: () => void;
};

function countLabel(text: string, count: number): string {
  return count > 0 ? `${text} · ${count} unread` : text;
}

function CountBubble({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.6rem] font-semibold tabular-nums leading-none text-primary-foreground ring-2 ring-shell"
      aria-hidden="true"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function RailButton({
  label,
  hover,
  active = false,
  count = 0,
  disabled = false,
  className,
  onClick,
  children,
}: {
  label: string;
  hover: HoverLabelControls;
  active?: boolean;
  count?: number;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const text = countLabel(label, count);
  return (
    <button
      type="button"
      className={cn(
        'relative grid size-11 shrink-0 place-items-center rounded-[0.9rem] border text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-border/70 bg-card text-foreground shadow-raised'
          : 'border-transparent hover:bg-card/60',
        'disabled:pointer-events-none disabled:opacity-60',
        className,
      )}
      aria-label={text}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={(event) => hover.show(text, event.currentTarget)}
      onMouseLeave={hover.hide}
      onFocus={(event) => hover.show(text, event.currentTarget)}
      onBlur={hover.hide}
      onClick={onClick}
    >
      {children}
      <CountBubble count={count} />
    </button>
  );
}

function RailDivider() {
  return <span className="my-1.5 h-px w-7 shrink-0 bg-border" aria-hidden="true" />;
}

/**
 * Collapsed navigation: an icon rail with the unified mailboxes, smart inboxes,
 * and one avatar per account. Hovering shows each item's label; an avatar opens
 * a folder flyout for that account. Managing folders, reordering accounts, and
 * editing smart inboxes stay in the expanded sidebar.
 */
export function SidebarRail({
  accounts,
  selection,
  syncRevision,
  syncStatus,
  onSelect,
  onCompose,
  onExpand,
  onManage,
}: {
  accounts: AccountSummary[];
  selection: MailboxSelection;
  syncRevision: number;
  syncStatus: MailSyncStatus;
  onSelect: (selection: MailboxSelection) => void;
  onCompose: () => void;
  onExpand: () => void;
  onManage: () => void;
}) {
  const [folderStates, setFolderStates] = useState<Record<string, FolderLoadState>>({});
  const [flyout, setFlyout] = useState<{ accountId: string; top: number } | null>(null);
  const [hoverLabel, setHoverLabel] = useState<{ text: string; top: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const smartInboxes = useSmartInboxes();
  const smartUnread = useSmartInboxUnreadCounts(smartInboxes.settings, syncRevision);
  const isMac = window.emzero?.platform === 'darwin';

  const hover: HoverLabelControls = {
    show: (text, element) => {
      const bounds = element.getBoundingClientRect();
      setHoverLabel({ text, top: bounds.top + bounds.height / 2 });
    },
    hide: () => setHoverLabel(null),
  };

  useEffect(() => {
    let active = true;
    void Promise.allSettled(accounts.map((account) => window.emzero.folders.list(account.id))).then(
      (results) => {
        if (!active) return;
        const next: Record<string, FolderLoadState> = {};
        results.forEach((result, index) => {
          next[accounts[index].id] =
            result.status === 'fulfilled' && result.value.ok
              ? { status: 'loaded', folders: result.value.folders }
              : {
                  status: 'error',
                  message: result.status === 'fulfilled'
                    ? (result.value.message ?? 'Could not load folders.')
                    : 'Could not load folders.',
                };
        });
        setFolderStates(next);
      },
    );
    return () => {
      active = false;
    };
  }, [accounts, syncRevision]);

  useEffect(() => {
    if (!flyout) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (flyoutRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-rail-account]')) return;
      setFlyout(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const accountId = flyout.accountId;
      setFlyout(null);
      document.querySelector<HTMLButtonElement>(`[data-rail-account="${CSS.escape(accountId)}"]`)?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [flyout]);

  const unifiedUnread = accounts.reduce((total, account) => {
    const state = folderStates[account.id];
    return total + (state?.status === 'loaded' ? inboxUnreadCount(state.folders) : 0);
  }, 0);
  const smartInboxList = smartInboxes.loaded && smartInboxes.settings.enabled
    ? smartInboxes.settings.inboxes
    : [];
  const flyoutAccount = flyout ? accounts.find((account) => account.id === flyout.accountId) : undefined;
  const flyoutState = flyoutAccount ? folderStates[flyoutAccount.id] : undefined;

  const selectFolder = (account: AccountSummary, folder: MailFolderSummary) => {
    onSelect({ kind: 'folder', account, folder });
    setFlyout(null);
  };

  return (
    <nav
      aria-label="Mailbox shortcuts"
      className={cn('relative flex h-full min-h-0 w-full flex-col items-center pb-3', isMac ? 'pt-12' : 'pt-3')}
    >
      <div className="flex shrink-0 flex-col items-center gap-1.5 pb-2">
        <RailButton label={`Expand sidebar (${isMac ? '⌘B' : 'Ctrl+B'})`} hover={hover} onClick={onExpand}>
          <PanelLeftOpen className="size-[1.1rem]" />
        </RailButton>
        <button
          type="button"
          className="mt-1 grid size-11 shrink-0 place-items-center rounded-[0.9rem] bg-ink text-ink-foreground shadow-sm outline-none transition-colors hover:bg-ink/85 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label="Compose"
          disabled={accounts.length === 0}
          onMouseEnter={(event) => hover.show('Compose', event.currentTarget)}
          onMouseLeave={hover.hide}
          onFocus={(event) => hover.show('Compose', event.currentTarget)}
          onBlur={hover.hide}
          onClick={onCompose}
        >
          <PenLine className="size-[1.1rem]" />
        </button>
      </div>

      <div
        className="rail-scroll flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden py-2"
        onScroll={() => {
          setHoverLabel(null);
          setFlyout(null);
        }}
      >
        <RailButton
          label="Search mail"
          hover={hover}
          active={selection.kind === 'search'}
          onClick={() => onSelect({ kind: 'search', query: '' })}
        >
          <Search className="size-[1.1rem]" />
        </RailButton>
        {mailboxes.map(({ mailbox, label, icon: Icon }) => (
          <RailButton
            key={mailbox}
            label={label}
            hover={hover}
            count={mailbox === 'inbox' ? unifiedUnread : 0}
            active={selection.kind === 'unified' && (selection.mailbox ?? 'inbox') === mailbox}
            onClick={() => onSelect({ kind: 'unified', mailbox })}
          >
            <Icon className="size-[1.1rem]" />
          </RailButton>
        ))}

        {smartInboxList.length > 0 && <RailDivider />}
        {smartInboxList.map((inbox) => (
          <RailButton
            key={inbox.id}
            label={inbox.name}
            hover={hover}
            count={smartUnread[inbox.id] ?? 0}
            active={selection.kind === 'smart' && selection.inboxId === inbox.id}
            onClick={() => onSelect({ kind: 'smart', inboxId: inbox.id })}
          >
            <SmartInboxIcon inbox={inbox} className="size-[1.1rem]" />
          </RailButton>
        ))}

        {accounts.length > 0 && <RailDivider />}
        {accounts.map((account) => {
          const state = folderStates[account.id];
          const unread = state?.status === 'loaded' ? accountUnreadCount(state.folders) : 0;
          const current = selection.kind === 'folder' && selection.account.id === account.id;
          const open = flyout?.accountId === account.id;
          const text = countLabel(`${account.name} · ${account.email}`, unread);
          return (
            <button
              key={account.id}
              type="button"
              data-rail-account={account.id}
              className={cn(
                'relative my-1 grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
                accountColorDotClass(account.color),
                current || open
                  ? 'shadow-[0_0_0_3px_var(--shell),0_0_0_5px_var(--ink)]'
                  : 'shadow-[0_0_0_3px_var(--shell),0_0_0_4px_var(--border)]',
              )}
              aria-label={`${text}, show folders`}
              aria-expanded={open}
              aria-haspopup="true"
              onMouseEnter={(event) => {
                if (!open) hover.show(text, event.currentTarget);
              }}
              onMouseLeave={hover.hide}
              onFocus={(event) => {
                if (!open) hover.show(text, event.currentTarget);
              }}
              onBlur={hover.hide}
              onClick={(event) => {
                hover.hide();
                if (open) {
                  setFlyout(null);
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                setFlyout({ accountId: account.id, top: Math.max(8, bounds.top - 12) });
              }}
            >
              {account.name.charAt(0).toUpperCase()}
              <CountBubble count={unread} />
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1.5 pt-2">
        <RailButton
          label={syncStatus.state === 'idle' && syncStatus.lastSyncedAt ? `Sync now · ${syncStatusLabel(syncStatus)}` : syncStatusLabel(syncStatus)}
          hover={hover}
          disabled={syncStatus.state === 'syncing' || accounts.length === 0}
          className={syncStatus.state === 'error' ? 'text-danger hover:text-danger' : undefined}
          onClick={() => void window.emzero.sync.now()}
        >
          <RefreshCw className={cn('size-[1.1rem]', syncStatus.state === 'syncing' && 'animate-spin')} />
        </RailButton>
        <RailButton label="Settings" hover={hover} onClick={onManage}>
          <Settings2 className="size-[1.1rem]" />
        </RailButton>
      </div>

      {hoverLabel && (
        <span
          className="pointer-events-none fixed left-[4.6rem] z-[60] -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-ink-foreground shadow-lg"
          style={{ top: hoverLabel.top }}
          aria-hidden="true"
        >
          {hoverLabel.text}
        </span>
      )}

      {flyout && flyoutAccount && (
        <div
          ref={flyoutRef}
          role="group"
          aria-label={`${flyoutAccount.name} folders`}
          className="fixed left-[4.75rem] z-50 flex max-h-[min(28rem,calc(100vh-1rem))] w-64 flex-col rounded-2xl border border-border/70 bg-card p-1.5 text-foreground shadow-xl"
          style={{ top: Math.min(flyout.top, window.innerHeight - 200) }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!event.currentTarget.contains(next) && !(next as Element | null)?.closest?.('[data-rail-account]')) {
              setFlyout(null);
            }
          }}
        >
          <div className="flex items-center gap-2.5 border-b border-border/60 px-2.5 pb-2.5 pt-2">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white', accountColorDotClass(flyoutAccount.color))}>
              {flyoutAccount.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{flyoutAccount.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{flyoutAccount.email}</span>
            </span>
          </div>
          <div className="min-h-0 overflow-y-auto pt-1.5">
            {(!flyoutState || flyoutState.status === 'loading') && (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                Loading folders
              </p>
            )}
            {flyoutState?.status === 'error' && (
              <p className="flex items-start gap-2 px-3 py-2 text-xs text-danger" title={flyoutState.message}>
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                Could not load folders.
              </p>
            )}
            {flyoutState?.status === 'loaded' &&
              visibleFolderTree(flyoutState.folders, new Set()).map((folder) => {
                const depth = folder.parentPath ? folder.parentPath.split(folder.delimiter).length : 0;
                const selected =
                  selection.kind === 'folder' &&
                  selection.account.id === flyoutAccount.id &&
                  selection.folder.path === folder.path;
                return (
                  <button
                    key={folder.path}
                    type="button"
                    className={cn(
                      'flex h-8 w-full items-center gap-2 rounded-[0.6rem] pr-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50',
                      selected ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                    style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
                    disabled={!folder.selectable}
                    title={folder.path}
                    onClick={() => selectFolder(flyoutAccount, folder)}
                  >
                    <FolderIcon specialUse={folder.specialUse} />
                    <span className="min-w-0 flex-1 truncate">{displayFolderName(folder)}</span>
                    {folder.specialUse !== '\\Drafts' && <UnreadBadge count={folder.unreadCount ?? 0} />}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </nav>
  );
}
