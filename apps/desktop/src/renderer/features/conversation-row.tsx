import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Flag, Mail, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AccountSummary, MailMessageSummary } from '../../shared/accounts';
import type { MailConversation } from '../../shared/conversations';
import type { EmzeroMessageColor } from '../../shared/message-keywords';
import {
  conversationAvatarUrl,
  conversationOpponent,
  conversationRepliedByMe,
  dueDateLabel,
  dueDateRowClass,
  messageColorBackgroundClass,
  messageDate,
  RepliedBadge,
  SelectionCheckbox,
  SenderAvatar,
} from './mail-common';
import { AccountColorDot } from './account-colors';
import type { InboxGroup } from './inbox-view-options';
import { conversationInsightMessage, MessageInsightTags } from './smart-inboxes';

export interface ConversationRowFacts {
  latest: MailMessageSummary;
  opponent: string;
  date: string | null;
  unread: boolean;
  flagged: boolean;
  hasDraft: boolean;
  replied: boolean;
  importantMessage: MailMessageSummary | undefined;
  color: EmzeroMessageColor | null;
}

/** Everything a list row and its actions need to know about one conversation in one folder. */
export function conversationRowFacts(
  conversation: MailConversation,
  folderPath: string,
  account: AccountSummary,
  draftFolderPaths: ReadonlySet<string>,
): ConversationRowFacts {
  const latest = conversation.messages[0];
  const inFolder = conversation.messages.filter((message) => message.folderPath === folderPath);
  return {
    latest,
    opponent: conversationOpponent(conversation.messages, account),
    date: latest.sentAt ?? latest.receivedAt,
    unread: inFolder.some((message) => message.unread),
    flagged: conversation.messages.some((message) => message.flagged),
    hasDraft: conversation.messages.some((message) => draftFolderPaths.has(message.folderPath)),
    replied: conversationRepliedByMe(conversation.messages, account, draftFolderPaths),
    importantMessage: inFolder.find((message) => message.important),
    color: inFolder.find((message) => message.color)?.color ?? null,
  };
}

export function ConversationRow({
  conversation,
  account,
  folderPath,
  facts,
  compact,
  showRecipients = false,
  showAccountDot = false,
  checked,
  selectionActive,
  open,
  rowRef,
  prefetch,
  onToggleChecked,
  onClick,
  onFocus,
  onContextMenu,
  actions,
}: {
  conversation: MailConversation;
  account: AccountSummary;
  folderPath: string;
  facts: ConversationRowFacts;
  compact: boolean;
  showRecipients?: boolean;
  showAccountDot?: boolean;
  checked: boolean;
  /** True while any row is checked, so every row shows its checkbox. */
  selectionActive: boolean;
  /** True when this conversation is open in the split-view reader. */
  open: boolean;
  rowRef: (node: HTMLButtonElement | null) => void;
  prefetch: { soon: () => void; cancel: () => void };
  onToggleChecked: (shiftKey: boolean) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  actions: ReactNode;
}) {
  const { latest, opponent, date, unread, flagged, hasDraft, replied, importantMessage, color } = facts;
  const dueClass = dueDateRowClass(importantMessage?.dueDate ?? null);
  const textTone = unread ? 'text-foreground' : 'text-foreground/75';

  return (
    <div
      className={cn(
        'mail-conversation-row group relative flex min-w-0 max-w-full items-center hover:bg-secondary/60',
        flagged && !dueClass && 'bg-starred-row hover:bg-starred-row-hover',
        dueClass,
        checked && 'bg-primary/8 ring-1 ring-inset ring-primary/15',
        open && 'bg-primary/10',
      )}
      role="listitem"
      onContextMenu={onContextMenu}
    >
      {unread && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2.5 left-0.5 w-[3px] rounded-full bg-primary"
        />
      )}
      <div
        className={compact
          ? 'relative ml-2 grid size-8 shrink-0 place-items-center'
          : 'relative ml-3 grid size-8 shrink-0 place-items-center lg:ml-4'}
        onClick={(event) => event.stopPropagation()}
      >
        <SenderAvatar
          label={opponent}
          imageUrl={conversationAvatarUrl(conversation.messages, account)}
          className={selectionActive
            ? 'opacity-0'
            : 'opacity-100 group-hover:opacity-0 group-focus-within:opacity-0'}
        />
        {showAccountDot && (
          <AccountColorDot account={account} className="absolute -bottom-0.5 -right-0.5 z-10" />
        )}
        <SelectionCheckbox
          checked={checked}
          className={cn(
            'absolute inset-0 m-auto transition-opacity group-hover:opacity-100 focus-within:opacity-100',
            selectionActive ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100',
          )}
          label={`Select conversation: ${conversation.subject}`}
          onChange={onToggleChecked}
        />
      </div>
      <button
        type="button"
        ref={rowRef}
        className={cn(
          'grid min-w-0 flex-1 items-center gap-y-0.5 text-left focus-visible:outline-none',
          compact
            ? 'grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2.5'
            : 'grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-2.5 lg:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] lg:gap-x-4',
        )}
        onMouseEnter={prefetch.soon}
        onMouseLeave={(event) => {
          if (document.activeElement !== event.currentTarget) prefetch.cancel();
        }}
        onFocus={() => {
          onFocus();
          prefetch.soon();
        }}
        onBlur={prefetch.cancel}
        onClick={(event) => {
          prefetch.cancel();
          onClick(event);
        }}
      >
        {unread && <span className="sr-only">Unread conversation.</span>}
        <span className={cn('min-w-0 truncate text-sm', textTone, unread && 'font-semibold')}>
          {showRecipients ? `To: ${opponent}` : opponent}
        </span>
        <div className={cn(
          'flex min-w-0 items-center gap-2',
          compact
            ? 'col-span-2 col-start-1 row-start-2'
            : 'col-span-2 col-start-1 row-start-2 lg:col-auto lg:row-auto',
        )}>
          <p className={cn('truncate text-sm', textTone, unread && 'font-medium')}>
            {hasDraft && <span className="mr-2 font-medium text-danger">Draft</span>}
            {replied && <RepliedBadge className="mr-2" />}
            {conversation.subject}
            {conversation.messages.length > 1 && (
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                {conversation.messages.length}
              </span>
            )}
          </p>
          <MessageInsightTags
            message={conversationInsightMessage(conversation, folderPath)}
            className="hidden sm:flex"
          />
        </div>
        <p
          className={cn(
            'min-w-0 truncate text-xs leading-5 text-muted-foreground/90',
            compact
              ? 'col-span-2 col-start-1 row-start-3'
              : 'col-span-2 col-start-1 row-start-3 lg:col-span-1 lg:col-start-2 lg:row-start-2',
          )}
          aria-hidden={latest.preview ? undefined : true}
        >
          {latest.preview || ' '}
        </p>
        <div className={cn(
          'flex items-center justify-end gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground',
          compact ? 'col-start-2 row-start-1' : 'col-start-2 row-start-1 lg:col-auto lg:row-auto',
        )}>
          {(flagged || importantMessage || color) && (
            <span className="flex items-center gap-1">
              {flagged && <Star className="size-3.5 fill-starred text-starred" aria-label="Starred" />}
              {importantMessage && (
                <span className="flex items-center gap-1 text-danger" title={dueDateLabel(importantMessage.dueDate)}>
                  <Flag className="size-3.5 fill-danger" aria-label="Important" />
                  <span className="hidden xl:inline">{dueDateLabel(importantMessage.dueDate)}</span>
                </span>
              )}
              {color && (
                <span
                  className={cn('size-2.5 rounded-full', messageColorBackgroundClass(color))}
                  aria-label={`${color} color`}
                />
              )}
            </span>
          )}
          <time dateTime={date ?? undefined} className={unread ? 'font-medium text-foreground/80' : undefined}>
            {messageDate(date)}
          </time>
        </div>
      </button>
      <div className={cn(
        compact
          ? 'absolute bottom-2 right-2 z-10 rounded-lg border border-border/60 bg-card p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100'
          : 'pr-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 lg:pr-4',
      )}>
        {actions}
      </div>
    </div>
  );
}

const groupOrder: readonly InboxGroup[] = ['starred', 'unread', 'other'];
const groupLabels: Record<InboxGroup, string> = {
  starred: 'Starred',
  unread: 'Unread',
  other: 'Everything else',
};

type DateBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older';
const dateBucketLabels: Record<DateBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Previous 7 days',
  month: 'Previous 30 days',
  older: 'Older',
};

export function dateBucket(value: string | null, now = new Date()): DateBucket {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'older';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const time = date.getTime();
  if (time >= startOfToday) return 'today';
  if (time >= startOfToday - day) return 'yesterday';
  if (time >= startOfToday - 7 * day) return 'week';
  if (time >= startOfToday - 30 * day) return 'month';
  return 'older';
}

/** Consecutive runs of items that share a key, preserving order. */
function runs<T, K>(items: readonly T[], keyOf: (item: T) => K): { key: K; items: T[] }[] {
  const result: { key: K; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = result.at(-1);
    if (last && last.key === key) last.items.push(item);
    else result.push({ key, items: [item] });
  }
  return result;
}

/**
 * Renders list rows inside rounded section cards. With `groupCounts`, rows are
 * split into Starred / Unread / Everything else cards with collapsible headers;
 * collapsed groups are expected to be absent from `items` already. Rows outside
 * the Starred and Unread groups get date sub-headings.
 */
export function ConversationSections<T>({
  items,
  groupOf,
  groupCounts,
  collapsedGroups,
  onToggleGroup,
  dateOf,
  keyOf,
  renderRow,
}: {
  items: readonly T[];
  groupOf: (item: T) => InboxGroup | null;
  groupCounts: ReadonlyMap<InboxGroup, number> | null;
  collapsedGroups: ReadonlySet<InboxGroup>;
  onToggleGroup: (group: InboxGroup) => void;
  dateOf: (item: T) => string | null;
  keyOf: (item: T) => string;
  renderRow: (item: T) => ReactNode;
}) {
  const now = new Date();
  const body = (sectionItems: readonly T[], withDates: boolean) =>
    withDates
      ? runs(sectionItems, (item) => dateBucket(dateOf(item), now)).map((run) => (
          <Fragment key={`${run.key}:${keyOf(run.items[0])}`}>
            <div className="bg-muted/35 px-4 py-1 text-[11px] font-medium text-muted-foreground" role="presentation">
              {dateBucketLabels[run.key]}
            </div>
            <div className="divide-y divide-border/40">{run.items.map(renderRow)}</div>
          </Fragment>
        ))
      : <div className="divide-y divide-border/40">{sectionItems.map(renderRow)}</div>;
  const card = 'divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/80 bg-card';

  if (!groupCounts) {
    return <div className={card}>{body(items, true)}</div>;
  }

  return (
    <>
      {groupOrder.map((group) => {
        const count = groupCounts.get(group) ?? 0;
        if (count === 0) return null;
        const collapsed = collapsedGroups.has(group);
        const sectionItems = collapsed ? [] : items.filter((item) => groupOf(item) === group);
        return (
          <div key={group} className={card} role="group" aria-label={groupLabels[group]}>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              aria-expanded={!collapsed}
              onClick={() => onToggleGroup(group)}
            >
              {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
              {group === 'starred' && <Star className="size-3 fill-starred text-starred" />}
              {group === 'unread' && <Mail className="size-3 text-primary" />}
              {groupLabels[group]}
              <span className="font-medium tabular-nums tracking-normal text-muted-foreground/70">{count}</span>
            </button>
            {!collapsed && body(sectionItems, group === 'other')}
          </div>
        );
      })}
    </>
  );
}
