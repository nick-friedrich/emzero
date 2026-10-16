import { MailViewMenu } from './mail-view-menu';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
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
import { cn } from '@/lib/utils';
import {
  type AccountSummary,
  type BulkMessageJobRequest,
  type MailMessageSummary,
  type MessageMoveDestination,
  findArchiveFolder,
  findInboxFolder,
} from '../../shared/accounts';
import {
  BulkActionToolbar,
  conversationWithMessage,
  MailLayoutToggle,
  SidebarHeaderToggle,
  messageCountInFolder,
  performConversationAction,
  type ConversationAction,
  type StartBulkOperation,
  type MailLayout,
  type UnifiedConversationItem,
  type UnifiedInboxLoadState,
  useCompactMailList,
} from './mail-common';
import { ConversationActions } from './conversation-actions';
import { AccountFilterBar, AccountMessages } from './unified-account-bar';
import { ConversationRow, conversationRowFacts, ConversationSections } from './conversation-row';
import { optimisticPatches, patchConversation, type MessagePatches } from './conversation-patches';
import { useListSelection, useReadToggleShortcut } from './list-selection';
import {
  loadUnifiedAccount,
  unifiedInboxState,
  unifiedItemKey as itemKey,
  unifiedStateWithoutDrafts,
  unifiedStateWithSavedDrafts,
  type UnifiedAccountLoad,
  type UnifiedMailbox,
} from './unified-inbox-data';
import { MailReaderPlaceholder, MailSplitLayout } from './mail-split-layout';
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
import type { EmzeroMessageColor } from '../../shared/message-keywords';
import { smartInboxContains, skipsUnifiedInbox } from '../../shared/mail-insights';
import {
  conversationInsightMessage,
  RemoveFromSmartInboxButton,
  useSmartInboxes,
} from './smart-inboxes';

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
  mailbox: UnifiedMailbox;
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
    // Accounts report in as they finish so one slow server does not hold up the
    // others. A complete list already on screen is kept until every account is done.
    const options = { mailbox, title, messageFilter, force: refreshKey > 0 };
    const settled = new Map<number, UnifiedAccountLoad>();
    const publish = () => {
      if (!active) return;
      const results = loadAccounts.flatMap((_, index) => settled.get(index) ?? []);
      const pending = loadAccounts.length - settled.size;
      if (pending === 0) {
        setState(unifiedInboxState(results, 0, isHidden));
        setRefreshing(false);
        return;
      }
      setState((current) =>
        current.status === 'loaded' && !current.pendingAccounts
          ? current
          : unifiedInboxState(results, pending, isHidden),
      );
    };
    if (loadAccounts.length === 0) void Promise.resolve().then(publish);
    loadAccounts.forEach((account, index) => {
      void loadUnifiedAccount(account, options).then((result) => {
        settled.set(index, result);
        publish();
      });
    });
    return () => {
      active = false;
    };
  }, [loadAccounts, mailbox, messageFilter, refreshKey, smart.loaded, syncRevision, title]);

  const refresh = () => {
    listSelection.clear();
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
      const { state: next, replacementItems } = unifiedStateWithSavedDrafts(current, {
        mailbox,
        account,
        folders: folderResult.folders,
        sourceFolder,
        draftFolderPath: event.reference.folderPath,
        draftMessages,
        draftTotal: draftResult.total,
        draftsSupportEmzeroKeywords: Boolean(draftResult.supportsEmzeroKeywords),
      });
      setSelectedItem((selected) => {
        if (!selected || selected.selection.account.id !== account.id) return selected;
        return replacementItems.find(
          (item) => item.conversation.id === selected.conversation.id,
        ) ?? selected;
      });
      return next;
    });
  }, [accounts, mailbox, setActionError]);

  const applyDraftDeleted = useCallback((event: DraftDeletedEvent) => {
    if (event.references.length === 0) return;
    setState((current) => {
      if (current.status !== 'loaded') return current;
      const next = unifiedStateWithoutDrafts(current, mailbox, event);
      setSelectedItem((selected) => {
        if (!selected || selected.selection.account.id !== event.accountId) return selected;
        return next.items.find((item) => itemKey(item) === itemKey(selected)) ?? null;
      });
      return next;
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
  const availableKeys = useMemo(() => availableItems.map(itemKey), [availableItems]);
  const listSelection = useListSelection(availableKeys);
  const {
    selectedKeys: selectedItemKeys,
    cursorKey: selectionCursorKey,
    setCursorKey: setSelectionCursorKey,
    rowRefs: unifiedRowRefs,
    deleteButtonRefs: unifiedDeleteButtonRefs,
  } = listSelection;
  useEffect(() => {
    const pendingKey = pendingUnifiedFocusKey.current;
    if (!pendingKey) return;
    const row = unifiedRowRefs.current.get(pendingKey);
    if (!row) return;
    pendingUnifiedFocusKey.current = null;
    row.focus();
  }, [availableItems, unifiedRowRefs]);
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
    const folderMessages = item.conversation.messages.filter(
      (message) => message.folderPath === item.selection.folder.path,
    );
    const patches = optimisticPatches(folderMessages, action, metadata);
    const applyPatches = (next: MessagePatches) => {
      const updateItem = (candidate: UnifiedConversationItem): UnifiedConversationItem =>
        itemKey(candidate) === key
          ? { ...candidate, conversation: patchConversation(candidate.conversation, next) }
          : candidate;
      setState((current) =>
        current.status === 'loaded' ? { ...current, items: current.items.map(updateItem) } : current,
      );
      setSelectedItem((current) => (current ? updateItem(current) : current));
    };
    if (patches) applyPatches(patches.apply);

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
        if (patches) applyPatches(patches.revert);
        return false;
      }
      onFoldersChanged?.();
      if (mailbox === 'starred' && action === 'unstar') removeItem();
      return true;
    } catch {
      setActionError('The action could not be completed.');
      if (patches) applyPatches(patches.revert);
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

  useReadToggleShortcut(!selectedItem, () => {
    const item = availableItems.find((candidate) => itemKey(candidate) === selectionCursorKey);
    if (!item) return false;
    const unread = item.conversation.messages.some(
      (message) => message.folderPath === item.selection.folder.path && message.unread,
    );
    void runAction(item, unread ? 'read' : 'unread');
    return true;
  });

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
        listSelection.clear();
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
                  listSelection.clear();
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
            listSelection.clear();
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

      {state.status === 'loaded' && (
        <>
          <AccountMessages tone="error" messages={state.failures} />
          <AccountMessages tone="notice" messages={state.notices} />
        </>
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
          onToggleAll={listSelection.toggleAll}
          onClear={listSelection.clear}
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
                  onToggleChecked={(shiftKey) => listSelection.toggleChecked(key, shiftKey)}
                  onClick={(event) => {
                    if (listSelection.handleModifierClick(event, key)) return;
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
      reader={reader ?? <MailReaderPlaceholder icon={Inbox} />}
    />
  );
}
