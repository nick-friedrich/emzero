import { useEffect, useState } from 'react';
import { CalendarClock, Mail, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailConversation } from '../../shared/conversations';
import type { UnifiedConversationItem } from './mail-common';

export type InboxFilter = 'all' | 'unread' | 'starred' | 'due';
export type InboxGroup = 'starred' | 'unread' | 'other';

const groupPriority: Record<InboxGroup, number> = { starred: 0, unread: 1, other: 2 };
const filterStorageKey = 'emzero:inbox-filter';

function storedFilter(): InboxFilter {
  const value = window.localStorage.getItem(filterStorageKey);
  return value === 'unread' || value === 'starred' || value === 'due' ? value : 'all';
}

function hasUnread(conversation: MailConversation, folderPath: string): boolean {
  return conversation.messages.some(
    (message) => message.folderPath === folderPath && message.unread,
  );
}

function hasStarred(conversation: MailConversation, folderPath: string): boolean {
  return conversation.messages.some(
    (message) => message.folderPath === folderPath && message.flagged,
  );
}

/** Earliest due date among the conversation's important messages in this folder, if any. */
function earliestDueDate(conversation: MailConversation, folderPath: string): string | null {
  let earliest: string | null = null;
  for (const message of conversation.messages) {
    if (message.folderPath !== folderPath || !message.important || !message.dueDate) continue;
    if (earliest === null || message.dueDate < earliest) earliest = message.dueDate;
  }
  return earliest;
}

function matchesFilter(conversation: MailConversation, folderPath: string, filter: InboxFilter): boolean {
  if (filter === 'unread') return hasUnread(conversation, folderPath);
  if (filter === 'starred') return hasStarred(conversation, folderPath);
  if (filter === 'due') return earliestDueDate(conversation, folderPath) !== null;
  return true;
}

/** Due-filter order: soonest (including overdue) first, then newest. */
function compareDue(
  left: MailConversation,
  leftFolder: string,
  right: MailConversation,
  rightFolder: string,
): number {
  const leftDue = earliestDueDate(left, leftFolder) ?? '';
  const rightDue = earliestDueDate(right, rightFolder) ?? '';
  if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
  return conversationTime(right) - conversationTime(left);
}

function conversationTime(conversation: MailConversation): number {
  const latest = conversation.messages[0];
  const value = latest?.sentAt ?? latest?.receivedAt;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function applyInboxView(
  conversations: MailConversation[],
  folderPath: string,
  filter: InboxFilter,
): MailConversation[] {
  const matching = conversations.filter((conversation) => matchesFilter(conversation, folderPath, filter));
  if (filter === 'due') {
    return matching.sort((left, right) => compareDue(left, folderPath, right, folderPath));
  }
  return matching
    .sort((left, right) => {
      const priority =
        groupPriority[inboxGroup(left, folderPath)] - groupPriority[inboxGroup(right, folderPath)];
      if (priority !== 0) return priority;
      return conversationTime(right) - conversationTime(left);
    });
}

export function applyUnifiedInboxView(
  items: UnifiedConversationItem[],
  filter: InboxFilter,
): UnifiedConversationItem[] {
  const matching = items.filter((item) =>
    matchesFilter(item.conversation, item.selection.folder.path, filter),
  );
  if (filter === 'due') {
    return matching.sort((left, right) =>
      compareDue(left.conversation, left.selection.folder.path, right.conversation, right.selection.folder.path),
    );
  }
  return matching
    .sort((left, right) => {
      const priority =
        groupPriority[inboxGroup(left.conversation, left.selection.folder.path)] -
        groupPriority[inboxGroup(right.conversation, right.selection.folder.path)];
      if (priority !== 0) return priority;
      return conversationTime(right.conversation) - conversationTime(left.conversation);
    });
}

export function inboxGroup(conversation: MailConversation, folderPath: string): InboxGroup {
  if (hasStarred(conversation, folderPath)) return 'starred';
  if (hasUnread(conversation, folderPath)) return 'unread';
  return 'other';
}

/** Stable-sorts items into Starred, Unread, then other mail, keeping each group's order. */
export function sortByInboxGroup<T>(items: readonly T[], groupOf: (item: T) => InboxGroup): T[] {
  return items
    .map((item, index) => ({ item, index, priority: groupPriority[groupOf(item)] }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ item }) => item);
}

export function countByInboxGroup<T>(
  items: readonly T[],
  groupOf: (item: T) => InboxGroup,
): ReadonlyMap<InboxGroup, number> {
  const counts = new Map<InboxGroup, number>();
  for (const item of items) {
    const group = groupOf(item);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return counts;
}

const collapsedStorageKey = 'emzero:collapsed-inbox-groups';

function storedCollapsedGroups(): ReadonlySet<InboxGroup> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(collapsedStorageKey) ?? '[]');
    return new Set(
      Array.isArray(value)
        ? value.filter((group): group is InboxGroup => group === 'starred' || group === 'unread' || group === 'other')
        : [],
    );
  } catch {
    return new Set();
  }
}

/** Persisted set of inbox sections the user has collapsed, shared by account and unified inboxes. */
export function useCollapsedInboxGroups() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<InboxGroup>>(storedCollapsedGroups);

  useEffect(() => {
    try {
      window.localStorage.setItem(collapsedStorageKey, JSON.stringify([...collapsed]));
    } catch {
      // Collapsing still works for this session without storage.
    }
  }, [collapsed]);

  const toggle = (group: InboxGroup) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  return { collapsed, toggle };
}

export function useInboxViewOptions() {
  const [filter, setFilter] = useState<InboxFilter>(storedFilter);

  useEffect(() => window.localStorage.setItem(filterStorageKey, filter), [filter]);

  return { filter, setFilter };
}

export function InboxViewOptions({
  filter,
  onFilterChange,
}: {
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
}) {
  return (
    <div className="flex items-center gap-1" aria-label="Filter inbox">
      <Button
        type="button"
        variant={filter === 'unread' ? 'secondary' : 'ghost'}
        className="header-tooltip size-9 px-0"
        aria-label={filter === 'unread' ? 'Show all mail' : 'Show unread only'}
        aria-pressed={filter === 'unread'}
        data-tooltip={filter === 'unread' ? 'Show all mail' : 'Show unread only'}
        onClick={() => onFilterChange(filter === 'unread' ? 'all' : 'unread')}
      >
        <Mail className="size-4" />
      </Button>
      <Button
        type="button"
        variant={filter === 'starred' ? 'secondary' : 'ghost'}
        className="header-tooltip size-9 px-0"
        aria-label={filter === 'starred' ? 'Show all mail' : 'Show starred only'}
        aria-pressed={filter === 'starred'}
        data-tooltip={filter === 'starred' ? 'Show all mail' : 'Show starred only'}
        onClick={() => onFilterChange(filter === 'starred' ? 'all' : 'starred')}
      >
        <Star className={filter === 'starred' ? 'size-4 fill-primary text-primary' : 'size-4'} />
      </Button>
      <Button
        type="button"
        variant={filter === 'due' ? 'secondary' : 'ghost'}
        className="header-tooltip size-9 px-0"
        aria-label={filter === 'due' ? 'Show all mail' : 'Show due only'}
        aria-pressed={filter === 'due'}
        data-tooltip={filter === 'due' ? 'Show all mail' : 'Show due only'}
        onClick={() => onFilterChange(filter === 'due' ? 'all' : 'due')}
      >
        <CalendarClock className={filter === 'due' ? 'size-4 text-primary' : 'size-4'} />
      </Button>
    </div>
  );
}
