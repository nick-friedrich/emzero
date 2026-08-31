import { useEffect, useState } from 'react';
import { Mail, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailConversation } from '../../shared/conversations';
import type { UnifiedConversationItem } from './mail-common';

export type InboxFilter = 'all' | 'unread' | 'starred';
export type InboxGroup = 'starred' | 'unread' | 'other';

const filterStorageKey = 'emzero:inbox-filter';

function storedFilter(): InboxFilter {
  const value = window.localStorage.getItem(filterStorageKey);
  return value === 'unread' || value === 'starred' ? value : 'all';
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
  return conversations
    .filter((conversation) =>
      filter === 'unread'
        ? hasUnread(conversation, folderPath)
        : filter === 'starred'
          ? hasStarred(conversation, folderPath)
          : true,
    )
    .sort((left, right) => {
      const groupPriority = { starred: 0, unread: 1, other: 2 };
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
  return items
    .filter((item) =>
      filter === 'unread'
        ? hasUnread(item.conversation, item.selection.folder.path)
        : filter === 'starred'
          ? hasStarred(item.conversation, item.selection.folder.path)
          : true,
    )
    .sort((left, right) => {
      const groupPriority = { starred: 0, unread: 1, other: 2 };
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

export function InboxGroupHeader({ group }: { group: InboxGroup }) {
  const label = { starred: 'Starred', unread: 'Unread', other: 'Other mail' }[group];
  return (
    <div className="flex items-center gap-2 border-y border-border bg-secondary/60 px-4 py-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground lg:px-6">
      {group === 'starred' && <Star className="size-3 fill-primary text-primary" />}
      {group === 'unread' && <Mail className="size-3 text-primary" />}
      {label}
    </div>
  );
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
    </div>
  );
}
