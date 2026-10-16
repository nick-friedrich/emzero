import { MailViewMenu } from './mail-view-menu';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CircleAlert,
  FileText,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import {
  cn,
  keysInRange,
} from '@/lib/utils';
import {
  type AccountSummary,
  type BulkMessageJobRequest,
  type MailMessageSummary,
  type MessageMoveDestination,
  findArchiveFolder,
  findInboxFolder,
} from '../../shared/accounts';
import {
  groupMessagesWithRelated,
  type MailConversation,
} from '../../shared/conversations';
import {
  BulkActionToolbar,
  conversationWithMessage,
  conversationWithFlaggedValues,
  conversationWithImportanceValues,
  conversationWithUnreadValues,
  isEditableTarget,
  MailLayoutToggle,
  SidebarHeaderToggle,
  messageCountInFolder,
  performConversationAction,
  type ConversationAction,
  type FolderSelection,
  type StartBulkOperation,
  type MailLayout,
  type UnifiedConversationItem,
  type UnifiedInboxLoadState,
  useCompactMailList,
} from './mail-common';
import { ConversationActions } from './conversation-actions';
import { accountColorDotClass } from './account-colors';
import { ConversationRow, conversationRowFacts, ConversationSections } from './conversation-row';
import { MailSplitLayout } from './mail-split-layout';
import { readerSelectionAfterRemoval } from './reader-selection';
import { ConversationReader } from './conversation-reader';
import type { DraftDeletedEvent, DraftSavedEvent } from './compose-dialog';
import { useMessagePrefetch } from './message-prefetch';
import { useUndoableAction } from './undoable-delete';
import { useTheme } from '@/theme';
import {
  applyUnifiedInboxView,
  countByInboxGroup,
  sortByInboxGroup,
  useCollapsedInboxGroups,
  inboxGroup,
  type InboxGroup,
  InboxViewOptions,
  useInboxViewOptions,
} from './inbox-view-options';
import { tomorrowDateKey, type EmzeroMessageColor } from '../../shared/message-keywords';
import { smartInboxContains, skipsUnifiedInbox } from '../../shared/mail-insights';
import {
  conversationInsightMessage,
  RemoveFromSmartInboxButton,
  useSmartInboxes,
} from './smart-inboxes';

function conversationTime(conversation: MailConversation): number {
  const latest = conversation.messages[0];
  const value = latest?.sentAt ?? latest?.receivedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function itemKey(item: UnifiedConversationItem): string {
  return `${item.selection.account.id}:${item.conversation.id}`;
}

function AccountFilterBar({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountSummary[];
  value: string | null;
  onChange: (accountId: string | null) => void;
}) {
  const chip = (active: boolean) => cn(
    'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-border bg-secondary font-medium text-foreground'
      : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
  );
  return (
    <div
      className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-4 py-2 lg:px-6"
      role="toolbar"
      aria-label="Filter by account"
    >
      <button type="button" className={chip(value === null)} aria-pressed={value === null} onClick={() => onChange(null)}>
        All accounts
      </button>
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          className={chip(value === account.id)}
          aria-pressed={value === account.id}
          title={account.email}
          onClick={() => onChange(value === account.id ? null : account.id)}
        >
          <span className={cn('size-2 rounded-full', accountColorDotClass(account.color))} aria-hidden="true" />
          {account.name}
        </button>
      ))}
    </div>
  );
}

export function UnifiedInbox({
  accounts,
  mailbox,
  onStartBulkOperation,
  mailLayout,
  onMailLayoutChange,
  sidebarPinned,
  onToggleSidebar,
  onFoldersChanged,
  syncRevision = 0,
  draftSavedEvent,
  draftDeletedEvent,
  smartInboxId,
}: {
  accounts: AccountSummary[];
  mailbox: 'inbox' | 'starred' | 'drafts' | 'trash';
  /** Show only Inbox mail that AI filed into this smart inbox. */
  smartInboxId?: string;
  onStartBulkOperation: StartBulkOperation;
  mailLayout: MailLayout;
  onMailLayoutChange: (layout: MailLayout) => void;
  sidebarPinned: boolean;
  onToggleSidebar: () => void;
  onFoldersChanged?: () => void;
  syncRevision?: number;
  draftSavedEvent?: DraftSavedEvent | null;
  draftDeletedEvent?: DraftDeletedEvent | null;
}) {
  const { selectNextOnDelete } = useTheme();
  const smart = useSmartInboxes();
  const smartInbox = smartInboxId
    ? smart.settings.inboxes.find((candidate) => candidate.id === smartInboxId)
    : undefined;
  const messageFilter = useMemo<((message: MailMessageSummary) => boolean) | null>(() => {
    const { enabled, inboxes } = smart.settings;
    if (smartInboxId) {
      const target = inboxes.find((candidate) => candidate.id === smartInboxId);
      return (message) => Boolean(enabled && target && smartInboxContains(target, message));
    }
    if (mailbox === 'inbox' && enabled && inboxes.some((candidate) => candidate.skipInbox)) {
      return (message) => !skipsUnifiedInbox(inboxes, message);
    }
    return null;
  }, [mailbox, smart.settings, smartInboxId]);
  const title = smartInbox?.name ?? {
    inbox: 'Inbox',
    starred: 'Starred',
    drafts: 'Drafts',
    trash: 'Trash',
  }[mailbox];
  const [state, setState] = useState<UnifiedInboxLoadState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Reload only when account details change, not when the same accounts arrive
  // as a new array or in a new order.
  const accountsKey = JSON.stringify([...accounts].sort((left, right) => left.id.localeCompare(right.id)));
  const [stableAccounts, setStableAccounts] = useState({ key: accountsKey, accounts });
  if (stableAccounts.key !== accountsKey) setStableAccounts({ key: accountsKey, accounts });
  const loadAccounts = stableAccounts.accounts;
  const [selectedItem, setSelectedItem] = useState<UnifiedConversationItem | null>(null);
  const [readingOrderKeys, setReadingOrderKeys] = useState<readonly string[] | null>(null);
  const [readingGroups, setReadingGroups] = useState<ReadonlyMap<string, InboxGroup> | null>(null);
  const unreadReadingQueue = useRef<readonly string[] | null>(null);
  const pendingActions = useRef(new Set<string>());
  const [busyConversations, setBusyConversations] = useState<ReadonlySet<string>>(new Set());
  const [actionsMenuKey, setActionsMenuKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);
  const [selectionCursorKey, setSelectionCursorKey] = useState<string | null>(null);
  const unifiedRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const unifiedDeleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingUnifiedFocusKey = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { scheduleAction, isHidden, undoBar } = useUndoableAction();
  const { ref: listSurfaceRef, compact: compactList } = useCompactMailList(
    mailLayout === 'split',
  );
  const inboxView = useInboxViewOptions();
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const activeAccountFilter = accounts.some((account) => account.id === accountFilter) ? accountFilter : null;

  useEffect(() => {
    if (!smart.loaded) return;
    let active = true;
    const loadAccount = async (account: AccountSummary) => {
      try {
        const folderResult = await window.emzero.folders.list(account.id, refreshKey > 0);
        if (!folderResult.ok) {
          return {
            failure: {
              account,
              message: folderResult.message ?? 'Could not load folders.',
            },
          };
        }

        const designatedFolder = mailbox === 'inbox'
          ? findInboxFolder(folderResult.folders)
          : folderResult.folders.find((candidate) =>
              candidate.selectable && candidate.specialUse === {
                starred: '\\Flagged',
                drafts: '\\Drafts',
                trash: '\\Trash',
              }[mailbox],
            );
        const sourceFolders = designatedFolder
          ? [designatedFolder]
          : mailbox === 'starred'
            ? folderResult.folders.filter((candidate) => candidate.selectable && candidate.specialUse !== '\\Trash')
            : [];
        if (sourceFolders.length === 0) {
          return { failure: { account, message: `No selectable ${title.toLowerCase()} folder was found.` } };
        }

        const sentFolder = folderResult.folders.find(
          (candidate) => candidate.selectable && candidate.specialUse === '\\Sent',
        );
        const inboxFolder = findInboxFolder(folderResult.folders);
        const draftsFolder = folderResult.folders.find(
          (candidate) => candidate.selectable && candidate.specialUse === '\\Drafts',
        );
        const relatedFolders = mailbox === 'inbox'
          ? [sentFolder, draftsFolder]
          : mailbox === 'drafts'
            ? [sentFolder, inboxFolder]
            : [];
        const [sourceResults, relatedResults] = await Promise.all([
          Promise.all(sourceFolders.map((folder) =>
            window.emzero.messages.list(account.id, folder.path, refreshKey > 0)
              .then((result) => ({ folder, result })),
          )),
          Promise.all(relatedFolders.flatMap((folder) =>
            folder && folder.path !== designatedFolder?.path
              ? [window.emzero.messages.list(account.id, folder.path, refreshKey > 0)
                  .then((result) => ({ folder, result }))]
              : [],
          )),
        ]);
        const failedResult = sourceResults.find(({ result }) => !result.ok);
        if (failedResult) {
          return {
            failure: {
              account,
              message: failedResult.result.message ?? `Could not load ${title.toLowerCase()} messages.`,
            },
          };
        }

        const loadedSources = sourceResults.map(({ folder, result }) => {
          const messages = result.messages
            .filter((message) => mailbox !== 'starred' || message.flagged)
            .filter((message) => !messageFilter || messageFilter(message))
            .map((message) => ({ ...message, folderPath: folder.path }));
          return {
            folder,
            supportsEmzeroKeywords: Boolean(result.supportsEmzeroKeywords),
            messages,
            total: mailbox === 'starred' || messageFilter ? messages.length : result.total,
            notice: result.message,
          };
        });
        const relatedMessages = relatedResults.flatMap(({ folder, result }) =>
          result.ok
            ? result.messages.map((message) => ({
                ...message,
                folderPath: folder.path,
              }))
            : [],
        );
        return {
          account,
          items: loadedSources.flatMap(({ folder, messages, supportsEmzeroKeywords }) => {
            const selection: FolderSelection = { kind: 'folder', account, folder };
            return groupMessagesWithRelated(
              messages,
              ['inbox', 'drafts'].includes(mailbox) ? relatedMessages : [],
            ).map((conversation) => ({
              selection,
              folders: folderResult.folders,
              conversation,
              supportsEmzeroKeywords,
            }));
          }),
          loadedMessages: loadedSources.reduce((total, source) => total + source.messages.length, 0),
          totalMessages: loadedSources.reduce((total, source) => total + source.total, 0),
          notices: [folderResult.message, ...loadedSources.map(({ notice }) => notice), ...relatedResults.map(({ result }) => result.message)].filter(
            (message): message is string => Boolean(message),
          ),
        };
      } catch {
        return { failure: { account, message: 'Could not connect to this account.' } };
      }
    };
    type AccountLoad = Awaited<ReturnType<typeof loadAccount>>;
    const buildState = (results: AccountLoad[], pendingAccounts: number): UnifiedInboxLoadState => {
      const items = results
        .flatMap((result) => ('items' in result && result.items ? result.items : []))
        .filter((item) => !isHidden(itemKey(item)))
        .sort(
          (left, right) =>
            conversationTime(right.conversation) - conversationTime(left.conversation),
        );
      const failures = results.flatMap((result) =>
        'failure' in result && result.failure ? [result.failure] : [],
      );
      const notices = results.flatMap((result) =>
        'notices' in result && result.notices
          ? result.notices.map((message) => ({ account: result.account, message }))
          : [],
      );
      return {
        status: 'loaded',
        items,
        failures,
        notices,
        loadedMessages: results.reduce(
          (total, result) => total + ('loadedMessages' in result ? (result.loadedMessages ?? 0) : 0),
          0,
        ),
        totalMessages: results.reduce(
          (total, result) => total + ('totalMessages' in result ? (result.totalMessages ?? 0) : 0),
          0,
        ),
        pendingAccounts,
      };
    };

    // Accounts report in as they finish so one slow server does not hold up the
    // others. A complete list already on screen is kept until every account is done.
    const settled = new Map<number, AccountLoad>();
    const publish = () => {
      if (!active) return;
      const results = loadAccounts.flatMap((_, index) => settled.get(index) ?? []);
      const pending = loadAccounts.length - settled.size;
      if (pending === 0) {
        setState(buildState(results, 0));
        setRefreshing(false);
        return;
      }
      setState((current) =>
        current.status === 'loaded' && !current.pendingAccounts ? current : buildState(results, pending),
      );
    };
    if (loadAccounts.length === 0) void Promise.resolve().then(publish);
    loadAccounts.forEach((account, index) => {
      void loadAccount(account).then((result) => {
        settled.set(index, result);
        publish();
      });
    });
    return () => {
      active = false;
    };
  }, [loadAccounts, mailbox, messageFilter, refreshKey, smart.loaded, syncRevision, title]);

  const refresh = () => {
    setSelectedItemKeys(new Set());
    setSelectionAnchorKey(null);
    setSelectionCursorKey(null);
    // Keep the list and any open conversation on screen; the header spinner shows the reload.
    setRefreshing(true);
    setRefreshKey((current) => current + 1);
  };

  const applyDraftSaved = useCallback(async (event: DraftSavedEvent) => {
    if (!['inbox', 'drafts'].includes(mailbox)) return;
    const account = accounts.find((candidate) => candidate.id === event.accountId);
    if (!account) return;
    const [folderResult, draftResult] = await Promise.all([
      window.emzero.folders.list(account.id),
      window.emzero.messages.list(account.id, event.reference.folderPath, true),
    ]);
    if (!folderResult.ok || !draftResult.ok) {
      setActionError(
        draftResult.message ?? folderResult.message ?? 'Could not refresh saved drafts.',
      );
      return;
    }
    const draftFolder = folderResult.folders.find(
      (folder) => folder.path === event.reference.folderPath,
    );
    const sourceFolder = mailbox === 'drafts'
      ? draftFolder
      : findInboxFolder(folderResult.folders);
    if (!sourceFolder) return;
    const draftMessages = draftResult.messages.map((message) => ({
      ...message,
      folderPath: event.reference.folderPath,
    }));
    setState((current) => {
      if (current.status !== 'loaded') return current;
      const accountItems = current.items.filter(
        (item) => item.selection.account.id === account.id,
      );
      const existingByKey = new Map(
        accountItems.flatMap((item) => item.conversation.messages).map(
          (message) => [`${message.folderPath}:${message.uid}`, message] as const,
        ),
      );
      const existingMessages = [...existingByKey.values()];
      const primaryMessages = mailbox === 'drafts'
        ? draftMessages
        : existingMessages.filter((message) => message.folderPath === sourceFolder.path);
      const relatedMessages = [
        ...(mailbox === 'inbox' ? draftMessages : []),
        ...existingMessages.filter(
          (message) =>
            message.folderPath !== sourceFolder.path &&
            message.folderPath !== event.reference.folderPath,
        ),
      ];
      const selection: FolderSelection = { kind: 'folder', account, folder: sourceFolder };
      const replacementItems = groupMessagesWithRelated(primaryMessages, relatedMessages).map(
        (conversation) => ({
          selection,
          folders: folderResult.folders,
          conversation,
          supportsEmzeroKeywords: mailbox === 'drafts'
            ? Boolean(draftResult.supportsEmzeroKeywords)
            : Boolean(sourceFolder.supportsEmzeroKeywords),
        }),
      );
      const items = [
        ...current.items.filter((item) => item.selection.account.id !== account.id),
        ...replacementItems,
      ].sort(
        (left, right) => conversationTime(right.conversation) - conversationTime(left.conversation),
      );
      setSelectedItem((selected) => {
        if (!selected || selected.selection.account.id !== account.id) return selected;
        return replacementItems.find(
          (item) => item.conversation.id === selected.conversation.id,
        ) ?? selected;
      });
      const previousPrimaryCount = existingMessages.filter(
        (message) => message.folderPath === sourceFolder.path,
      ).length;
      return {
        ...current,
        items,
        loadedMessages: mailbox === 'drafts'
          ? current.loadedMessages - previousPrimaryCount + draftMessages.length
          : current.loadedMessages,
        totalMessages: mailbox === 'drafts'
          ? current.totalMessages - previousPrimaryCount + draftResult.total
          : current.totalMessages,
      };
    });
  }, [accounts, mailbox]);

  const applyDraftDeleted = useCallback((event: DraftDeletedEvent) => {
    if (event.references.length === 0) return;
    const deleted = new Set(event.references.map(
      (reference) => `${reference.folderPath}:${reference.uid}`,
    ));
    const draftFolderPaths = new Set(event.references.map((reference) => reference.folderPath));
    setState((current) => {
      if (current.status !== 'loaded') return current;
      let removedMessages = 0;
      const items = current.items.flatMap((item) => {
        if (item.selection.account.id !== event.accountId) return [item];
        const messages = item.conversation.messages.filter((message) => {
          const remove = deleted.has(`${message.folderPath}:${message.uid}`);
          if (remove) removedMessages += 1;
          return !remove;
        });
        const remainsInDrafts = mailbox !== 'drafts' || messages.some(
          (message) => draftFolderPaths.has(message.folderPath),
        );
        return messages.length > 0 && remainsInDrafts
          ? [{ ...item, conversation: { ...item.conversation, messages } }]
          : [];
      });
      setSelectedItem((selected) => {
        if (!selected || selected.selection.account.id !== event.accountId) return selected;
        return items.find((item) => itemKey(item) === itemKey(selected)) ?? null;
      });
      const removedPrimaryMessages = mailbox === 'drafts' ? removedMessages : 0;
      return {
        ...current,
        items,
        loadedMessages: Math.max(0, current.loadedMessages - removedPrimaryMessages),
        totalMessages: Math.max(0, current.totalMessages - removedPrimaryMessages),
      };
    });
  }, [mailbox]);

  useEffect(() => {
    if (!draftSavedEvent) return;
    const timer = window.setTimeout(() => void applyDraftSaved(draftSavedEvent), 0);
    return () => window.clearTimeout(timer);
  }, [applyDraftSaved, draftSavedEvent]);

  useEffect(() => {
    if (!draftDeletedEvent) return;
    const timer = window.setTimeout(() => applyDraftDeleted(draftDeletedEvent), 0);
    return () => window.clearTimeout(timer);
  }, [applyDraftDeleted, draftDeletedEvent]);

  const visibleItems = useMemo(() => {
    const loadedItems = state.status === 'loaded' ? state.items : [];
    const items = activeAccountFilter
      ? loadedItems.filter((item) => item.selection.account.id === activeAccountFilter)
      : loadedItems;
    return mailbox === 'inbox'
      ? applyUnifiedInboxView(items, inboxView.filter)
      : items;
  }, [activeAccountFilter, inboxView.filter, mailbox, state]);
  const collapsedGroups = useCollapsedInboxGroups();
  const groupOf = useCallback(
    (item: UnifiedConversationItem): InboxGroup =>
      (selectedItem ? readingGroups?.get(itemKey(item)) : undefined) ??
      inboxGroup(item.conversation, item.selection.folder.path),
    [readingGroups, selectedItem],
  );
  const orderedItems = useMemo(() => {
    let ordered = visibleItems;
    if (selectedItem && readingOrderKeys && state.status === 'loaded') {
      const byKey = new Map(state.items.map((item) => [itemKey(item), item]));
      const pinnedKeys = new Set(readingOrderKeys);
      ordered = [
        ...readingOrderKeys.flatMap((key) => {
          const item = byKey.get(key);
          return item ? [item] : [];
        }),
        ...visibleItems.filter((item) => !pinnedKeys.has(itemKey(item))),
      ];
    }
    return mailbox === 'inbox' ? sortByInboxGroup(ordered, groupOf) : ordered;
  }, [groupOf, mailbox, readingOrderKeys, selectedItem, state, visibleItems]);
  const groupCounts = useMemo(
    () => mailbox === 'inbox' ? countByInboxGroup(orderedItems, groupOf) : null,
    [groupOf, mailbox, orderedItems],
  );
  // Rows in collapsed sections are left out of keyboard navigation, ranges, and reading order.
  const availableItems = useMemo(
    () => mailbox === 'inbox'
      ? orderedItems.filter((item) => !collapsedGroups.collapsed.has(groupOf(item)))
      : orderedItems,
    [collapsedGroups.collapsed, groupOf, mailbox, orderedItems],
  );
  useEffect(() => {
    const pendingKey = pendingUnifiedFocusKey.current;
    if (!pendingKey) return;
    const row = unifiedRowRefs.current.get(pendingKey);
    if (!row) return;
    pendingUnifiedFocusKey.current = null;
    row.focus();
  }, [availableItems]);
  const prefetchTargets = useMemo(
    () =>
      availableItems.map((item) => ({
        accountId: item.selection.account.id,
        folderPath: item.conversation.messages[0].folderPath,
        uid: item.conversation.messages[0].uid,
      })),
    [availableItems],
  );
  const { prefetchSoon, cancelPrefetch } = useMessagePrefetch(prefetchTargets);
  const selectedItems = availableItems.filter((item) => selectedItemKeys.has(itemKey(item)));
  const selectedEmailCount = selectedItems.reduce(
    (total, item) =>
      total + messageCountInFolder(item.conversation, item.selection.folder.path),
    0,
  );
  const bulkMoveFolders = selectedItems[0]?.folders ?? [];
  const bulkMoveSourcePath = selectedItems[0]?.selection.folder.path ?? '';

  useEffect(() => {
    const handleSelectionShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (event.key === 'Escape' && selectedItemKeys.size > 0) {
        event.preventDefault();
        setSelectedItemKeys(new Set());
        setSelectionAnchorKey(null);
        setSelectionCursorKey(null);
        return;
      }
      const keys = availableItems.map((item) => itemKey(item));
      if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSelectedItemKeys(new Set(keys));
        setSelectionAnchorKey(keys[0] ?? null);
        setSelectionCursorKey(keys.at(-1) ?? null);
        return;
      }
      const cursorIndex = selectionCursorKey ? keys.indexOf(selectionCursorKey) : -1;
      const cursorItem = cursorIndex >= 0 ? availableItems[cursorIndex] : undefined;
      if (event.key === 'Delete' && cursorItem) {
        event.preventDefault();
        unifiedDeleteButtonRefs.current.get(itemKey(cursorItem))?.click();
        return;
      }
      if (
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        ['ArrowUp', 'ArrowDown'].includes(event.key) &&
        keys.length > 0
      ) {
        event.preventDefault();
        const nextIndex = cursorIndex < 0
          ? event.key === 'ArrowDown' ? 0 : keys.length - 1
          : Math.max(
              0,
              Math.min(keys.length - 1, cursorIndex + (event.key === 'ArrowDown' ? 1 : -1)),
            );
        setSelectionCursorKey(keys[nextIndex]);
        unifiedRowRefs.current.get(keys[nextIndex])?.focus();
        return;
      }
      if (!event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || keys.length === 0) return;
      event.preventDefault();
      let rangeCursorIndex = selectionCursorKey
        ? keys.indexOf(selectionCursorKey)
        : keys.findIndex((key) => selectedItemKeys.has(key));
      if (rangeCursorIndex < 0) rangeCursorIndex = event.key === 'ArrowDown' ? 0 : keys.length - 1;
      const anchorIndex = selectionAnchorKey ? keys.indexOf(selectionAnchorKey) : rangeCursorIndex;
      const nextIndex = Math.max(
        0,
        Math.min(keys.length - 1, rangeCursorIndex + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      const safeAnchorIndex = anchorIndex < 0 ? rangeCursorIndex : anchorIndex;
      setSelectedItemKeys(keysInRange(keys, safeAnchorIndex, nextIndex));
      setSelectionAnchorKey(keys[safeAnchorIndex]);
      setSelectionCursorKey(keys[nextIndex]);
      unifiedRowRefs.current.get(keys[nextIndex])?.focus();
    };
    window.addEventListener('keydown', handleSelectionShortcut);
    return () => window.removeEventListener('keydown', handleSelectionShortcut);
  }, [availableItems, selectedItemKeys, selectionAnchorKey, selectionCursorKey]);

  useEffect(
    () => {
      return window.emzero.messages.onBulkJobProgress((progress) => {
        if (!progress.processedUids || !progress.accountId || !progress.folderPath) return;
        const processed = new Set(progress.processedUids);
        setState((current) => {
      if (current.status !== 'loaded') return current;
      let affectedMessages = 0;
      const items = current.items.flatMap((item) => {
        if (
          item.selection.account.id !== progress.accountId ||
          item.selection.folder.path !== progress.folderPath
        ) {
          return [item];
        }
        const affected = item.conversation.messages.filter(
          (message) =>
            message.folderPath === progress.folderPath && processed.has(message.uid),
        ).length;
        if (affected === 0) return [item];
        affectedMessages += affected;
        if (['delete', 'archive', 'move'].includes(progress.action)) {
          const messages = item.conversation.messages.filter(
            (message) =>
              message.folderPath !== progress.folderPath || !processed.has(message.uid),
          );
          return messages.some((message) => message.folderPath === progress.folderPath)
            ? [{ ...item, conversation: { ...item.conversation, messages } }]
            : [];
        }
        const isFlagAction = progress.action === 'star' || progress.action === 'unstar';
        if (mailbox === 'starred' && progress.action === 'unstar') {
          return [];
        }
        const nextValue = progress.action === 'unread' || progress.action === 'star';
        return [
          {
            ...item,
            conversation: {
              ...item.conversation,
              messages: item.conversation.messages.map((message) =>
                message.folderPath === progress.folderPath && processed.has(message.uid)
                  ? isFlagAction
                    ? { ...message, flagged: nextValue }
                    : { ...message, unread: nextValue }
                  : message,
              ),
            },
          },
        ];
      });
      return {
        ...current,
        items,
        loadedMessages:
          ['delete', 'archive', 'move'].includes(progress.action) ||
          (mailbox === 'starred' && progress.action === 'unstar')
            ? Math.max(0, current.loadedMessages - affectedMessages)
            : current.loadedMessages,
        totalMessages:
          ['delete', 'archive', 'move'].includes(progress.action) ||
          (mailbox === 'starred' && progress.action === 'unstar')
            ? Math.max(0, current.totalMessages - affectedMessages)
            : current.totalMessages,
      };
        });
      });
    },
    [mailbox],
  );

  const runAction = async (
    item: UnifiedConversationItem,
    action: ConversationAction,
    destination?: MessageMoveDestination,
    metadata?: { dueDate?: string; color?: EmzeroMessageColor | null },
  ) => {
    const key = itemKey(item);
    // Delete and move are removed optimistically and committed after the undo
    // delay, so they must not wait for an in-flight flag change such as
    // mark-read-on-open.
    const deferred = action === 'delete' || action === 'move';
    if (!deferred) {
      if (pendingActions.current.has(key)) return false;
      pendingActions.current.add(key);
      setBusyConversations((current) => new Set(current).add(key));
    }
    setActionError(null);
    const previousUnread = new Map(
      item.conversation.messages
        .filter((message) => message.folderPath === item.selection.folder.path)
        .map((message) => [`${message.folderPath}:${message.uid}`, message.unread]),
    );
    const previousFlagged = new Map(
      item.conversation.messages
        .filter((message) => message.folderPath === item.selection.folder.path)
        .map((message) => [`${message.folderPath}:${message.uid}`, message.flagged]),
    );
    const previousImportance = new Map(
      item.conversation.messages
        .filter((message) => message.folderPath === item.selection.folder.path)
        .map((message) => [
          `${message.folderPath}:${message.uid}`,
          { important: message.important, dueDate: message.dueDate },
        ]),
    );
    const previousColors = new Map(
      item.conversation.messages
        .filter((message) => message.folderPath === item.selection.folder.path)
        .map((message) => [`${message.folderPath}:${message.uid}`, message.color]),
    );
    const updateUnread = (unreadByMessage: ReadonlyMap<string, boolean>) => {
      const updateItem = (candidate: UnifiedConversationItem): UnifiedConversationItem =>
        itemKey(candidate) === key
          ? {
              ...candidate,
              conversation: conversationWithUnreadValues(
                candidate.conversation,
                unreadByMessage,
              ),
            }
          : candidate;
      setState((current) =>
        current.status === 'loaded'
          ? { ...current, items: current.items.map(updateItem) }
          : current,
      );
      setSelectedItem((current) => (current ? updateItem(current) : current));
    };
    const updateFlagged = (flaggedByMessage: ReadonlyMap<string, boolean>) => {
      const updateItem = (candidate: UnifiedConversationItem): UnifiedConversationItem =>
        itemKey(candidate) === key
          ? {
              ...candidate,
              conversation: conversationWithFlaggedValues(
                candidate.conversation,
                flaggedByMessage,
              ),
            }
          : candidate;
      setState((current) =>
        current.status === 'loaded' ? { ...current, items: current.items.map(updateItem) } : current,
      );
      setSelectedItem((current) => (current ? updateItem(current) : current));
    };
    const updateImportance = (
      importanceByMessage: ReadonlyMap<string, { important: boolean; dueDate: string | null }>,
    ) => {
      const updateItem = (candidate: UnifiedConversationItem): UnifiedConversationItem =>
        itemKey(candidate) === key
          ? { ...candidate, conversation: conversationWithImportanceValues(candidate.conversation, importanceByMessage) }
          : candidate;
      setState((current) => current.status === 'loaded'
        ? { ...current, items: current.items.map(updateItem) }
        : current);
      setSelectedItem((current) => (current ? updateItem(current) : current));
    };
    const updateColors = (colors: ReadonlyMap<string, EmzeroMessageColor | null>) => {
      const updateItem = (candidate: UnifiedConversationItem): UnifiedConversationItem =>
        itemKey(candidate) === key
          ? {
              ...candidate,
              conversation: {
                ...candidate.conversation,
                messages: candidate.conversation.messages.map((message) => {
                  const color = colors.get(`${message.folderPath}:${message.uid}`);
                  return color === undefined ? message : { ...message, color };
                }),
              },
            }
          : candidate;
      setState((current) => current.status === 'loaded'
        ? { ...current, items: current.items.map(updateItem) }
        : current);
      setSelectedItem((current) => (current ? updateItem(current) : current));
    };

    if (action === 'read' || action === 'unread') {
      const unread = action === 'unread';
      updateUnread(new Map([...previousUnread.keys()].map((messageKey) => [messageKey, unread])));
    }
    if (action === 'star' || action === 'unstar') {
      const flagged = action === 'star';
      updateFlagged(new Map([...previousFlagged.keys()].map((messageKey) => [messageKey, flagged])));
    }
    if (action === 'mark-important' || action === 'clear-important') {
      const important = action === 'mark-important';
      const dueDate = important ? (metadata?.dueDate ?? tomorrowDateKey()) : null;
      updateImportance(new Map([...previousImportance.keys()].map((messageKey) => [
        messageKey,
        { important, dueDate },
      ])));
    }
    if (action === 'set-color' || action === 'clear-color') {
      const color = action === 'set-color' ? (metadata?.color ?? null) : null;
      updateColors(new Map([...previousColors.keys()].map((messageKey) => [messageKey, color])));
    }

    const previousState = state;
    const previousSelection = selectedItem;
    const removeItem = () => {
      let nextItem: UnifiedConversationItem | undefined;
      if (action === 'delete') {
        const queue = selectedItem && itemKey(selectedItem) === key
          ? unreadReadingQueue.current
          : null;
        if (queue && state.status === 'loaded') {
          const availableByKey = new Map(state.items.map((candidate) => [itemKey(candidate), candidate]));
          const removedIndex = queue.indexOf(key);
          const nextKey = removedIndex >= 0
            ? queue.slice(removedIndex + 1).find((candidateKey) => availableByKey.has(candidateKey))
              ?? queue.slice(0, removedIndex).reverse().find((candidateKey) => availableByKey.has(candidateKey))
            : undefined;
          nextItem = nextKey ? availableByKey.get(nextKey) : undefined;
        } else {
          const removedIndex = availableItems.findIndex(
            (candidate) => itemKey(candidate) === key,
          );
          nextItem = removedIndex >= 0
            ? availableItems[removedIndex + 1] ?? availableItems[removedIndex - 1]
            : undefined;
        }
        const nextKey = nextItem ? itemKey(nextItem) : null;
        pendingUnifiedFocusKey.current = nextKey;
        setSelectionCursorKey(nextKey);
      }
      setState((current) =>
        current.status === 'loaded'
          ? {
              ...current,
              items: current.items.filter((candidate) => itemKey(candidate) !== key),
              loadedMessages: Math.max(
                0,
                current.loadedMessages -
                  item.conversation.messages.filter(
                    (message) => message.folderPath === item.selection.folder.path,
                  ).length,
              ),
              totalMessages: Math.max(
                0,
                current.totalMessages -
                  item.conversation.messages.filter(
                    (message) => message.folderPath === item.selection.folder.path,
                  ).length,
              ),
            }
          : current,
      );
      setSelectedItem((current) => readerSelectionAfterRemoval({
        current,
        keyOf: itemKey,
        removedKey: key,
        selectNext: action === 'delete' && selectNextOnDelete,
        next: nextItem,
      }));
    };
    const restoreItem = () => {
      setState(previousState);
      setSelectedItem(previousSelection);
    };

    if (deferred) {
      removeItem();
      const archive = destination?.accountId === item.selection.account.id
        ? item.folders.find((folder) => folder.path === destination.folderPath)?.specialUse === '\\Archive'
        : false;
      scheduleAction(
        action === 'delete' ? 'Conversation deleted' : archive ? 'Conversation archived' : 'Conversation moved',
        () => performConversationAction(
          item.selection.account.id,
          item.selection.folder.path,
          item.conversation,
          action,
          destination,
          metadata,
        ),
        restoreItem,
        setActionError,
        onFoldersChanged,
        [key],
      );
      return true;
    }

    try {
      const error = await performConversationAction(
        item.selection.account.id,
        item.selection.folder.path,
        item.conversation,
        action,
        destination,
        metadata,
      );
      if (error) {
        setActionError(error);
        if (action === 'read' || action === 'unread') updateUnread(previousUnread);
        if (action === 'star' || action === 'unstar') updateFlagged(previousFlagged);
        if (action === 'mark-important' || action === 'clear-important') updateImportance(previousImportance);
        if (action === 'set-color' || action === 'clear-color') updateColors(previousColors);
        return false;
      }
      onFoldersChanged?.();
      if (mailbox === 'starred' && action === 'unstar') removeItem();
      return true;
    } catch {
      setActionError('The action could not be completed.');
      if (action === 'read' || action === 'unread') updateUnread(previousUnread);
      if (action === 'star' || action === 'unstar') updateFlagged(previousFlagged);
      if (action === 'mark-important' || action === 'clear-important') updateImportance(previousImportance);
      if (action === 'set-color' || action === 'clear-color') updateColors(previousColors);
      return false;
    } finally {
      pendingActions.current.delete(key);
      setBusyConversations((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const runShortcutAction = useEffectEvent(runAction);

  useEffect(() => {
    if (selectedItem) return;
    const handleReadShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditableTarget(event.target) ||
        event.key.toLowerCase() !== 'q' ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const item = availableItems.find((candidate) => itemKey(candidate) === selectionCursorKey);
      if (!item) return;
      event.preventDefault();
      const unread = item.conversation.messages.some(
        (message) => message.folderPath === item.selection.folder.path && message.unread,
      );
      void runShortcutAction(item, unread ? 'read' : 'unread');
    };
    window.addEventListener('keydown', handleReadShortcut);
    return () => window.removeEventListener('keydown', handleReadShortcut);
  }, [availableItems, selectedItem, selectionCursorKey]);

  const runBulkAction = async (
    action: BulkMessageJobRequest['action'],
    destination?: MessageMoveDestination,
  ) => {
    if (bulkBusy) return;
    const groups = new Map<string, BulkMessageJobRequest['groups'][number]>();
    for (const item of selectedItems) {
      const { account, folder } = item.selection;
      const key = `${account.id}:${folder.path}`;
      const group = groups.get(key) ?? {
        accountId: account.id,
        folderPath: folder.path,
        uids: [],
        ...(destination
          ? {
              destinationAccountId: destination.accountId,
              destinationPath: destination.folderPath,
            }
          : {}),
      };
      group.uids.push(
        ...item.conversation.messages
          .filter((message) => message.folderPath === folder.path)
          .map((message) => message.uid),
      );
      groups.set(key, group);
    }
    setBulkBusy(true);
    try {
      const result = await onStartBulkOperation(
        {
          action,
          groups: [...groups.values()].map((group) => ({
            ...group,
            uids: [...new Set(group.uids)],
          })),
        },
        title,
      );
      if (result.ok) {
        setSelectedItemKeys(new Set());
        setSelectionAnchorKey(null);
        setSelectionCursorKey(null);
      } else {
        setActionError(result.message ?? 'The bulk action could not be started.');
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const reader = selectedItem ? (
      <ConversationReader
        accounts={accounts}
        key={`${selectedItem.selection.account.id}:${selectedItem.conversation.id}`}
        selection={selectedItem.selection}
        folders={selectedItem.folders}
        conversation={selectedItem.conversation}
        onBack={() => {
          unreadReadingQueue.current = null;
          setReadingGroups(null);
          setReadingOrderKeys(null);
          setSelectedItem(null);
        }}
        navigationVariant={mailLayout === 'split' ? 'close' : 'back'}
        busy={busyConversations.has(itemKey(selectedItem))}
        actionError={actionError}
        onSetUnread={(unread) =>
          void runAction(selectedItem, unread ? 'unread' : 'read')
        }
        onSetFlagged={(flagged) =>
          void runAction(selectedItem, flagged ? 'star' : 'unstar')
        }
        supportsEmzeroKeywords={selectedItem.supportsEmzeroKeywords}
        onSetImportant={(important, dueDate) =>
          void runAction(selectedItem, important ? 'mark-important' : 'clear-important', undefined, { dueDate })
        }
        onSetColor={(color) => void runAction(selectedItem, color ? 'set-color' : 'clear-color', undefined, { color })}
        onMove={(destination) => void runAction(selectedItem, 'move', destination)}
        onDelete={() => void runAction(selectedItem, 'delete')}
        onReplySent={(message) => {
          setSelectedItem((current) =>
            current
              ? { ...current, conversation: conversationWithMessage(current.conversation, message) }
              : current,
          );
          setState((current) =>
            current.status === 'loaded'
              ? {
                  ...current,
                  items: current.items.map((candidate) =>
                    itemKey(candidate) === itemKey(selectedItem)
                      ? {
                          ...candidate,
                          conversation: conversationWithMessage(candidate.conversation, message),
                        }
                      : candidate,
                  ),
                }
              : current,
          );
        }}
        onDraftSaved={applyDraftSaved}
        onDraftDeleted={applyDraftDeleted}
      />
    ) : null;

  if (reader && mailLayout === 'list') {
    return reader;
  }

  const pendingAccounts = state.status === 'loaded' ? state.pendingAccounts ?? 0 : 0;
  const waitingForMail =
    state.status === 'loading' || (state.status === 'loaded' && pendingAccounts > 0 && state.items.length === 0);
  const busyLoading = state.status === 'loading' || refreshing || pendingAccounts > 0;

  const list = (
    <section
      ref={listSurfaceRef}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      <header className={cn(
        'mail-pane-header flex min-w-0 items-center justify-between gap-3 border-b border-border/60 bg-card py-3 pl-16 pr-4 lg:px-6',
        compactList && 'lg:px-4',
        window.emzero?.platform === 'darwin' && 'macos-content-header macos-titlebar-drag',
      )}>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {smartInbox
              ? smartInbox.rule
              : `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MailViewMenu>
            <SidebarHeaderToggle pinned={sidebarPinned} onToggle={onToggleSidebar} />
            <MailLayoutToggle layout={mailLayout} onChange={onMailLayoutChange} />
            {mailbox === 'inbox' && (
              <InboxViewOptions
                filter={inboxView.filter}
                onFilterChange={(filter) => {
                  inboxView.setFilter(filter);
                  setSelectedItemKeys(new Set());
                  setSelectionAnchorKey(null);
                  setSelectionCursorKey(null);
                }}
              />
            )}
          </MailViewMenu>
          {!compactList && state.status === 'loaded' && (
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground lg:inline">
              {orderedItems.length} {orderedItems.length === 1 ? 'conversation' : 'conversations'}
              {' · '}
              {state.loadedMessages < state.totalMessages
                ? `newest ${state.loadedMessages} of ${state.totalMessages} messages`
                : `${state.totalMessages} ${state.totalMessages === 1 ? 'message' : 'messages'}`}
            </span>
          )}
          <Button
            variant="ghost"
            className="size-8 px-0"
            aria-label={`Refresh ${title.toLowerCase()}`}
            title={`Refresh ${title.toLowerCase()}`}
            disabled={busyLoading}
            onClick={refresh}
          >
            <RefreshCw className={`size-4 ${busyLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {accounts.length > 1 && (
        <AccountFilterBar
          accounts={accounts}
          value={activeAccountFilter}
          onChange={(accountId) => {
            setAccountFilter(accountId);
            setSelectedItemKeys(new Set());
            setSelectionAnchorKey(null);
            setSelectionCursorKey(null);
          }}
        />
      )}

      {waitingForMail && (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" />
            Fetching {title.toLowerCase()}
          </div>
        </div>
      )}

      {state.status === 'loaded' && state.failures.length > 0 && (
        <div className="border-b border-danger/20 bg-danger/8 px-4 py-3 text-xs text-danger lg:px-6">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div>
              {state.failures.map(({ account, message }) => (
                <p key={account.id} title={message}>
                  <span className="font-semibold">{account.name}:</span> {message}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.status === 'loaded' && state.notices.length > 0 && (
        <div className="border-b border-border bg-secondary px-4 py-3 text-xs text-muted-foreground lg:px-6">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div>
              {state.notices.map(({ account, message }) => (
                <p key={`${account.id}:${message}`}>
                  <span className="font-semibold">{account.name}:</span> {message}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.status === 'loaded' && actionError && (
        <div className="border-b border-danger/20 bg-danger/8 px-4 py-3 text-xs text-danger lg:px-6">
          {actionError}
        </div>
      )}

      {state.status === 'loaded' && selectedItemKeys.size > 0 && (
        <BulkActionToolbar
          accounts={accounts}
          sourceAccountId={selectedItems[0]?.selection.account.id ?? accounts[0]?.id ?? ''}
          sourceLocations={selectedItems.map((item) => ({
            accountId: item.selection.account.id,
            folderPath: item.selection.folder.path,
          }))}
          folders={bulkMoveFolders}
          sourcePath={bulkMoveSourcePath}
          canArchive={selectedItems.every((item) => {
            const archive = findArchiveFolder(item.folders);
            return Boolean(archive && archive.path !== item.selection.folder.path);
          })}
          selectedRows={selectedItemKeys.size}
          selectedEmails={selectedEmailCount}
          totalRows={availableItems.length}
          busy={bulkBusy}
          permanentDelete={mailbox === 'trash'}
          onToggleAll={() => {
            const keys = availableItems.map((item) => itemKey(item));
            if (selectedItemKeys.size === availableItems.length) {
              setSelectedItemKeys(new Set());
              setSelectionAnchorKey(null);
              setSelectionCursorKey(null);
            } else {
              setSelectedItemKeys(new Set(keys));
              setSelectionAnchorKey(keys[0] ?? null);
              setSelectionCursorKey(keys.at(-1) ?? null);
            }
          }}
          onClear={() => {
            setSelectedItemKeys(new Set());
            setSelectionAnchorKey(null);
            setSelectionCursorKey(null);
          }}
          onAction={(action) => void runBulkAction(action)}
          onMove={(destination) => void runBulkAction('move', destination)}
        />
      )}

      {state.status === 'loaded' && state.items.length === 0 && pendingAccounts === 0 && (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            {mailbox === 'trash'
              ? <Trash2 className="mx-auto size-8 text-muted-foreground" />
              : mailbox === 'starred'
                ? <Star className="mx-auto size-8 text-muted-foreground" />
                : mailbox === 'drafts'
                  ? <FileText className="mx-auto size-8 text-muted-foreground" />
                  : <Inbox className="mx-auto size-8 text-muted-foreground" />}
            <h2 className="mt-3 font-semibold">
              {state.failures.length === accounts.length
                ? `${title} could not be loaded`
                : `Your ${title.toLowerCase()} is empty`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.failures.length === accounts.length
                ? 'Check the account errors above, then try again.'
                : 'There are no messages to show.'}
            </p>
            {state.failures.length === accounts.length && (
              <Button className="mt-5" variant="secondary" onClick={refresh}>
                <RefreshCw className="size-4" />
                Try again
              </Button>
            )}
          </div>
        </div>
      )}

      {state.status === 'loaded' && state.items.length > 0 && orderedItems.length === 0 && (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Inbox className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No matching conversations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Try showing all mail or choosing another filter.
            </p>
          </div>
        </div>
      )}

      {state.status === 'loaded' && orderedItems.length > 0 && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3" role="list" aria-label="Messages">
          <ConversationSections
            items={availableItems}
            groupOf={groupOf}
            groupCounts={groupCounts}
            collapsedGroups={collapsedGroups.collapsed}
            onToggleGroup={collapsedGroups.toggle}
            dateOf={(item) => item.conversation.messages[0].sentAt ?? item.conversation.messages[0].receivedAt}
            keyOf={itemKey}
            renderRow={(item) => {
              const { conversation, selection } = item;
              const key = itemKey(item);
              const draftFolderPaths = new Set(
                item.folders
                  .filter((folder) => folder.specialUse === '\\Drafts')
                  .map((folder) => folder.path),
              );
              const facts = conversationRowFacts(conversation, selection.folder.path, selection.account, draftFolderPaths);
              const { unread, flagged, importantMessage, color } = facts;
              const prefetchTarget = {
                accountId: selection.account.id,
                folderPath: facts.latest.folderPath,
                uid: facts.latest.uid,
              };
              return (
                <ConversationRow
                  key={key}
                  conversation={conversation}
                  account={selection.account}
                  folderPath={selection.folder.path}
                  facts={facts}
                  compact={compactList}
                  showAccountDot
                  checked={selectedItemKeys.has(key)}
                  selectionActive={selectedItemKeys.size > 0}
                  open={mailLayout === 'split' && selectedItem !== null && itemKey(selectedItem) === key}
                  rowRef={(node) => {
                    if (node) unifiedRowRefs.current.set(key, node);
                    else unifiedRowRefs.current.delete(key);
                  }}
                  prefetch={{
                    soon: () => prefetchSoon(prefetchTarget),
                    cancel: () => cancelPrefetch(prefetchTarget),
                  }}
                  onContextMenu={(event) => {
                    if (busyConversations.has(key)) return;
                    event.preventDefault();
                    setActionsMenuKey(key);
                  }}
                  onFocus={() => setSelectionCursorKey(key)}
                  onToggleChecked={(shiftKey) => {
                    const keys = availableItems.map((candidate) => itemKey(candidate));
                    const key = itemKey(item);
                    const targetIndex = keys.indexOf(key);
                    const anchorIndex = selectionAnchorKey ? keys.indexOf(selectionAnchorKey) : -1;
                    if (shiftKey && anchorIndex >= 0) {
                      setSelectedItemKeys(keysInRange(keys, anchorIndex, targetIndex));
                    } else {
                      setSelectedItemKeys((current) => {
                      const key = itemKey(item);
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                      });
                      setSelectionAnchorKey(key);
                    }
                    setSelectionCursorKey(key);
                  }}
                  onClick={(event) => {
                    if (event.shiftKey) {
                      const keys = availableItems.map((candidate) => itemKey(candidate));
                      const key = itemKey(item);
                      const targetIndex = keys.indexOf(key);
                      const anchorIndex = selectionAnchorKey ? keys.indexOf(selectionAnchorKey) : targetIndex;
                      setSelectedItemKeys(keysInRange(keys, anchorIndex, targetIndex));
                      setSelectionAnchorKey(keys[anchorIndex]);
                      setSelectionCursorKey(key);
                      return;
                    }
                    if (event.ctrlKey || event.metaKey) {
                      const key = itemKey(item);
                      setSelectedItemKeys((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                      setSelectionAnchorKey(key);
                      setSelectionCursorKey(key);
                      return;
                    }
                    setActionError(null);
                    const openedUnread = item.conversation.messages.some(
                      (message) => message.folderPath === item.selection.folder.path && message.unread,
                    );
                    unreadReadingQueue.current = openedUnread
                      ? availableItems
                          .filter((candidate) => candidate.conversation.messages.some(
                            (message) => message.folderPath === candidate.selection.folder.path && message.unread,
                          ))
                          .map((candidate) => itemKey(candidate))
                      : null;
                    setReadingOrderKeys(orderedItems.map((candidate) => itemKey(candidate)));
                    setReadingGroups(mailbox === 'inbox'
                      ? new Map(orderedItems.map((candidate) => [itemKey(candidate), groupOf(candidate)]))
                      : null);
                    setSelectedItem(item);
                  }}
                  actions={(
                    <ConversationActions
                      accounts={accounts}
                      sourceAccountId={selection.account.id}
                      folders={item.folders}
                      sourcePath={selection.folder.path}
                      messageCount={messageCountInFolder(item.conversation, selection.folder.path)}
                      unread={unread}
                      flagged={flagged}
                      important={Boolean(importantMessage)}
                      dueDate={importantMessage?.dueDate ?? null}
                      color={color}
                      supportsEmzeroKeywords={item.supportsEmzeroKeywords}
                      busy={busyConversations.has(key)}
                      confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
                      subject={conversation.subject}
                      actionsOpen={actionsMenuKey === key}
                      onActionsOpenChange={(open) => setActionsMenuKey(open ? key : null)}
                      onSetUnread={(nextUnread) =>
                        void runAction(item, nextUnread ? 'unread' : 'read')
                      }
                      onSetFlagged={(nextFlagged) =>
                        void runAction(item, nextFlagged ? 'star' : 'unstar')
                      }
                      onSetImportant={(nextImportant, dueDate) =>
                        void runAction(item, nextImportant ? 'mark-important' : 'clear-important', undefined, { dueDate })
                      }
                      onSetColor={(nextColor) => void runAction(item, nextColor ? 'set-color' : 'clear-color', undefined, { color: nextColor })}
                      onMove={(destination) => void runAction(item, 'move', destination)}
                      onDelete={() => void runAction(item, 'delete')}
                      leadingAction={smartInbox && (
                        <RemoveFromSmartInboxButton
                          inbox={smartInbox}
                          sender={
                            conversationInsightMessage(conversation, selection.folder.path)
                              ?.from[0]?.address?.toLowerCase() ?? null
                          }
                        />
                      )}
                      deleteButtonRef={(node) => {
                        if (node) unifiedDeleteButtonRefs.current.set(key, node);
                        else unifiedDeleteButtonRefs.current.delete(key);
                      }}
                    />
                  )}
                />
              );
            }}
          />
        </div>
      )}
      {undoBar}
    </section>
  );

  if (mailLayout === 'list') return list;

  return (
    <MailSplitLayout
      list={list}
      reader={reader ?? (
          <div className="relative grid h-full place-items-center p-8 text-center text-muted-foreground">
            {window.emzero?.platform === 'darwin' && (
              <div className="macos-titlebar-drag absolute inset-x-0 top-0 h-12" aria-hidden="true" />
            )}
            <div>
              <Inbox className="mx-auto size-8" />
              <p className="mt-3 text-sm">Select a conversation to read it here.</p>
            </div>
          </div>
      )}
    />
  );
}
