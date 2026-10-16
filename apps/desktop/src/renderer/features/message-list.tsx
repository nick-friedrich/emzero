import { MailViewMenu } from './mail-view-menu';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CircleAlert,
  LoaderCircle,
  Mail,
  RefreshCw,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  type AccountSummary,
  type BulkMessageJobRequest,
  type MailFolderSummary,
  type MailMessageSummary,
  type MessageMoveDestination,
  displayFolderName,
} from '../../shared/accounts';
import {
  groupMessagesWithRelated,
  type MailConversation,
} from '../../shared/conversations';
import {
  BulkActionToolbar,
  conversationWithMessage,
  MailLayoutToggle,
  SidebarHeaderToggle,
  messageCountInFolder,
  performConversationAction,
  type ConversationAction,
  type FolderSelection,
  type MessageLoadState,
  type MailLayout,
  type StartBulkOperation,
  useCompactMailList,
} from './mail-common';
import { ConversationActions } from './conversation-actions';
import { MailReaderPlaceholder, MailSplitLayout } from './mail-split-layout';
import { readerSelectionAfterRemoval } from './reader-selection';
import { ConversationReader } from './conversation-reader';
import type { DraftDeletedEvent, DraftSavedEvent } from './compose-dialog';
import { useMessagePrefetch } from './message-prefetch';
import { useUndoableAction } from './undoable-delete';
import { useTheme } from '@/theme';
import {
  applyInboxView,
  countByInboxGroup,
  sortByInboxGroup,
  useCollapsedInboxGroups,
  inboxGroup,
  type InboxGroup,
  InboxViewOptions,
  useInboxViewOptions,
} from './inbox-view-options';
import type { EmzeroMessageColor } from '../../shared/message-keywords';
import { ConversationRow, conversationRowFacts, ConversationSections } from './conversation-row';
import {
  messageKey,
  optimisticPatches,
  patchConversation,
  patchMessage,
  type MessagePatches,
} from './conversation-patches';
import { useListSelection, useReadToggleShortcut } from './list-selection';

export function MessageList({
  accounts,
  selection,
  onStartBulkOperation,
  mailLayout,
  onMailLayoutChange,
  sidebarPinned,
  onToggleSidebar,
  onFoldersChanged,
  syncRevision = 0,
  draftSavedEvent,
  draftDeletedEvent,
}: {
  accounts: AccountSummary[];
  selection: FolderSelection;
  onStartBulkOperation: StartBulkOperation;
  mailLayout: MailLayout;
  onMailLayoutChange: (layout: MailLayout) => void;
  sidebarPinned: boolean;
  onToggleSidebar: () => void;
  onFoldersChanged: () => void;
  syncRevision?: number;
  draftSavedEvent?: DraftSavedEvent | null;
  draftDeletedEvent?: DraftDeletedEvent | null;
}) {
  const [state, setState] = useState<MessageLoadState>({ status: 'loading' });
  const { selectNextOnDelete } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<MailConversation | null>(null);
  const [readingOrderIds, setReadingOrderIds] = useState<readonly string[] | null>(null);
  const [readingGroups, setReadingGroups] = useState<ReadonlyMap<string, InboxGroup> | null>(null);
  const unreadReadingQueue = useRef<readonly string[] | null>(null);
  const pendingActions = useRef(new Set<string>());
  const [busyConversations, setBusyConversations] = useState<ReadonlySet<string>>(new Set());
  const [actionsMenuKey, setActionsMenuKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingConversationFocusId = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [folders, setFolders] = useState<MailFolderSummary[]>([selection.folder]);
  const { scheduleAction, isHidden, undoBar } = useUndoableAction();
  const { ref: listSurfaceRef, compact: compactList } = useCompactMailList(
    mailLayout === 'split',
  );
  const inboxView = useInboxViewOptions();
  const isInbox = displayFolderName(selection.folder) === 'Inbox';
  const draftFolderPaths = useMemo(
    () => new Set(folders.filter((folder) => folder.specialUse === '\\Drafts').map((folder) => folder.path)),
    [folders],
  );

  useEffect(() => {
    let active = true;
    void window.emzero.folders.list(selection.account.id).then((result) => {
      if (active && result.ok) setFolders(result.folders);
    });
    return () => { active = false; };
  }, [selection.account.id]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [result, folderResult] = await Promise.all([
        window.emzero.messages.list(selection.account.id, selection.folder.path, refreshKey > 0),
        window.emzero.folders.list(selection.account.id, refreshKey > 0),
      ]);
      if (!result.ok) {
        if (active) {
          setState({ status: 'error', message: result.message ?? 'Could not load messages.' });
          setRefreshing(false);
        }
        return;
      }
      const messages = result.messages
        .map((message) => ({ ...message, folderPath: selection.folder.path }))
        .filter((message) => !isHidden(`${message.folderPath}:${message.uid}`));

      const relatedMessages: MailMessageSummary[] = [];
      const notices = [result.message];
      const relatedFolders = folderResult.ok
        ? folderResult.folders.filter((folder) =>
            folder.selectable &&
            folder.path !== selection.folder.path &&
            (folder.specialUse === '\\Sent' ||
              folder.specialUse === '\\Drafts' ||
              (['\\Sent', '\\Drafts'].includes(selection.folder.specialUse ?? '') &&
                folder.specialUse === '\\Inbox')),
          )
        : [];
      notices.push(folderResult.message);
      const relatedResults = await Promise.all(relatedFolders.map(async (folder) => ({
        folder,
        result: await window.emzero.messages.list(
          selection.account.id,
          folder.path,
          refreshKey > 0,
        ),
      })));
      for (const { folder, result: relatedResult } of relatedResults) {
        notices.push(relatedResult.message);
        if (relatedResult.ok) {
          relatedMessages.push(...relatedResult.messages
            .map((message) => ({ ...message, folderPath: folder.path }))
            .filter((message) => !isHidden(`${message.folderPath}:${message.uid}`)));
        }
      }

      if (active) {
        setState({
          status: 'loaded',
          messages,
          relatedMessages,
          total: result.total,
          supportsEmzeroKeywords: Boolean(result.supportsEmzeroKeywords),
          notice: notices.filter(Boolean).join(' '),
        });
        setRefreshing(false);
      }
    })()
      .catch(() => {
        if (active) {
          setState({ status: 'error', message: 'Could not load messages.' });
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshKey, selection.account.id, selection.folder.path, selection.folder.specialUse, syncRevision]);

  const refresh = () => {
    listSelection.clear();
    // Keep the current list on screen; the header spinner shows the reload.
    setRefreshing(true);
    setRefreshKey((current) => current + 1);
  };

  const applyDraftSaved = useCallback(async (event: DraftSavedEvent) => {
    if (event.accountId !== selection.account.id) return;
    const result = await window.emzero.messages.list(
      event.accountId,
      event.reference.folderPath,
      true,
    );
    if (!result.ok) {
      setActionError(result.message ?? 'Could not refresh saved drafts.');
      return;
    }
    const draftMessages = result.messages.map((message) => ({
      ...message,
      folderPath: event.reference.folderPath,
    }));
    setState((current) => {
      if (current.status !== 'loaded') return current;
      const inSelectedFolder = selection.folder.path === event.reference.folderPath;
      const messages = inSelectedFolder ? draftMessages : current.messages;
      const relatedMessages = inSelectedFolder
        ? current.relatedMessages
        : [
            ...draftMessages,
            ...current.relatedMessages.filter(
              (message) => message.folderPath !== event.reference.folderPath,
            ),
          ];
      const nextConversations = groupMessagesWithRelated(messages, relatedMessages);
      setSelectedConversation((selected) => selected
        ? nextConversations.find((conversation) => conversation.id === selected.id) ?? selected
        : selected);
      return {
        ...current,
        messages,
        relatedMessages,
        total: inSelectedFolder ? result.total : current.total,
        notice: result.message ?? current.notice,
      };
    });
  }, [selection.account.id, selection.folder.path]);

  const applyDraftDeleted = useCallback((event: DraftDeletedEvent) => {
    if (event.accountId !== selection.account.id || event.references.length === 0) return;
    const deleted = new Set(event.references.map(
      (reference) => `${reference.folderPath}:${reference.uid}`,
    ));
    setState((current) => {
      if (current.status !== 'loaded') return current;
      const removedPrimaryCount = current.messages.filter(
        (message) => deleted.has(`${message.folderPath}:${message.uid}`),
      ).length;
      const messages = current.messages.filter(
        (message) => !deleted.has(`${message.folderPath}:${message.uid}`),
      );
      const relatedMessages = current.relatedMessages.filter(
        (message) => !deleted.has(`${message.folderPath}:${message.uid}`),
      );
      const nextConversations = groupMessagesWithRelated(messages, relatedMessages);
      setSelectedConversation((selected) => selected
        ? nextConversations.find((conversation) => conversation.id === selected.id) ?? null
        : selected);
      return {
        ...current,
        messages,
        relatedMessages,
        total: Math.max(0, current.total - removedPrimaryCount),
      };
    });
  }, [selection.account.id]);

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

  const showRecipients = selection.folder.specialUse === '\\Sent';
  const allConversations = useMemo(
    () =>
      state.status === 'loaded'
        ? groupMessagesWithRelated(state.messages, state.relatedMessages)
        : [],
    [state],
  );
  const visibleConversations = useMemo(
    () => isInbox
      ? applyInboxView(
          allConversations,
          selection.folder.path,
          inboxView.filter,
        )
      : allConversations,
    [allConversations, inboxView.filter, isInbox, selection.folder.path],
  );
  const collapsedGroups = useCollapsedInboxGroups();
  const groupOf = useCallback(
    (conversation: MailConversation): InboxGroup =>
      (selectedConversation ? readingGroups?.get(conversation.id) : undefined) ??
      inboxGroup(conversation, selection.folder.path),
    [readingGroups, selectedConversation, selection.folder.path],
  );
  const orderedConversations = useMemo(() => {
    let ordered = visibleConversations;
    if (selectedConversation && readingOrderIds) {
      const byId = new Map(allConversations.map((conversation) => [conversation.id, conversation]));
      const pinnedIds = new Set(readingOrderIds);
      ordered = [
        ...readingOrderIds.flatMap((id) => {
          const conversation = byId.get(id);
          return conversation ? [conversation] : [];
        }),
        ...visibleConversations.filter((conversation) => !pinnedIds.has(conversation.id)),
      ];
    }
    return isInbox ? sortByInboxGroup(ordered, groupOf) : ordered;
  }, [allConversations, groupOf, isInbox, readingOrderIds, selectedConversation, visibleConversations]);
  const groupCounts = useMemo(
    () => isInbox ? countByInboxGroup(orderedConversations, groupOf) : null,
    [groupOf, isInbox, orderedConversations],
  );
  // Rows in collapsed sections are left out of keyboard navigation, ranges, and reading order.
  const conversations = useMemo(
    () => isInbox
      ? orderedConversations.filter((conversation) => !collapsedGroups.collapsed.has(groupOf(conversation)))
      : orderedConversations,
    [collapsedGroups.collapsed, groupOf, isInbox, orderedConversations],
  );
  const conversationKeys = useMemo(
    () => conversations.map((conversation) => conversation.id),
    [conversations],
  );
  const listSelection = useListSelection(conversationKeys);
  const {
    selectedKeys: selectedConversationIds,
    cursorKey: selectionCursorId,
    setCursorKey: setSelectionCursorId,
    rowRefs: conversationRowRefs,
    deleteButtonRefs: conversationDeleteButtonRefs,
  } = listSelection;
  useEffect(() => {
    const pendingId = pendingConversationFocusId.current;
    if (!pendingId) return;
    const row = conversationRowRefs.current.get(pendingId);
    if (!row) return;
    pendingConversationFocusId.current = null;
    row.focus();
  }, [conversationRowRefs, conversations]);
  const prefetchTargets = useMemo(
    () =>
      conversations.map((conversation) => ({
        accountId: selection.account.id,
        folderPath: conversation.messages[0].folderPath,
        uid: conversation.messages[0].uid,
      })),
    [conversations, selection.account.id],
  );
  const { prefetchSoon, cancelPrefetch } = useMessagePrefetch(prefetchTargets);
  const selectedConversations = conversations.filter((conversation) =>
    selectedConversationIds.has(conversation.id),
  );
  const selectedEmailCount = selectedConversations.reduce(
    (total, conversation) => total + messageCountInFolder(conversation, selection.folder.path),
    0,
  );

  useEffect(
    () =>
      window.emzero.messages.onBulkJobProgress((progress) => {
        if (
          !progress.processedUids ||
          progress.accountId !== selection.account.id ||
          progress.folderPath !== selection.folder.path
        ) {
          return;
        }
        const processed = new Set(progress.processedUids);
        setState((current) => {
          if (current.status !== 'loaded') return current;
          if (['delete', 'archive', 'move'].includes(progress.action)) {
            const removed = current.messages.filter((message) => processed.has(message.uid)).length;
            return {
              ...current,
              messages: current.messages.filter((message) => !processed.has(message.uid)),
              total: Math.max(0, current.total - removed),
            };
          }
          const isFlagAction = progress.action === 'star' || progress.action === 'unstar';
          const nextValue = progress.action === 'unread' || progress.action === 'star';
          return {
            ...current,
            messages: current.messages.map((message) =>
              processed.has(message.uid)
                ? isFlagAction
                  ? { ...message, flagged: nextValue }
                  : { ...message, unread: nextValue }
                : message,
            ),
          };
        });
      }),
    [selection.account.id, selection.folder.path],
  );

  const runAction = async (
    conversation: MailConversation,
    action: ConversationAction,
    destination?: MessageMoveDestination,
    metadata?: { dueDate?: string; color?: EmzeroMessageColor | null },
  ) => {
    // Delete and move are removed optimistically and committed after the undo
    // delay, so they must not wait for an in-flight flag change such as
    // mark-read-on-open.
    const deferred = action === 'delete' || action === 'move';
    if (!deferred) {
      if (pendingActions.current.has(conversation.id)) return false;
      pendingActions.current.add(conversation.id);
      setBusyConversations((current) => new Set(current).add(conversation.id));
    }
    setActionError(null);
    const folderMessages = conversation.messages.filter(
      (message) => message.folderPath === selection.folder.path,
    );
    const keys = new Set(folderMessages.map(messageKey));
    const patches = optimisticPatches(folderMessages, action, metadata);
    const applyPatches = (next: MessagePatches) => {
      const update = (message: MailMessageSummary) => patchMessage(message, next);
      setState((current) => current.status === 'loaded'
        ? { ...current, messages: current.messages.map(update), relatedMessages: current.relatedMessages.map(update) }
        : current);
      setSelectedConversation((current) =>
        current?.id === conversation.id ? patchConversation(current, next) : current,
      );
    };
    if (patches) applyPatches(patches.apply);

    const previousState = state;
    const previousSelection = selectedConversation;
    const removeConversation = () => {
      let nextConversation: MailConversation | undefined;
      if (action === 'delete') {
        const queue = selectedConversation?.id === conversation.id
          ? unreadReadingQueue.current
          : null;
        if (queue) {
          const availableById = new Map(allConversations.map((candidate) => [candidate.id, candidate]));
          const removedIndex = queue.indexOf(conversation.id);
          const nextId = removedIndex >= 0
            ? queue.slice(removedIndex + 1).find((id) => availableById.has(id))
              ?? queue.slice(0, removedIndex).reverse().find((id) => availableById.has(id))
            : undefined;
          nextConversation = nextId ? availableById.get(nextId) : undefined;
        } else {
          const removedIndex = conversations.findIndex(
            (candidate) => candidate.id === conversation.id,
          );
          nextConversation = removedIndex >= 0
            ? conversations[removedIndex + 1] ?? conversations[removedIndex - 1]
            : undefined;
        }
        const nextId = nextConversation?.id ?? null;
        pendingConversationFocusId.current = nextId;
        setSelectionCursorId(nextId);
      }
      setState((current) =>
        current.status === 'loaded'
          ? {
              ...current,
              messages: current.messages.filter(
                (message) => !keys.has(messageKey(message)),
              ),
              relatedMessages: current.relatedMessages.filter(
                (message) => !keys.has(messageKey(message)),
              ),
              total: Math.max(
                0,
                current.total -
                  current.messages.filter((message) =>
                    keys.has(messageKey(message)),
                  ).length,
              ),
            }
          : current,
      );
      setSelectedConversation((current) => readerSelectionAfterRemoval({
        current,
        keyOf: (candidate) => candidate.id,
        removedKey: conversation.id,
        selectNext: action === 'delete' && selectNextOnDelete,
        next: nextConversation,
      }));
    };
    const restoreConversation = () => {
      setState(previousState);
      setSelectedConversation(previousSelection);
    };

    if (deferred) {
      removeConversation();
      const archive = destination?.accountId === selection.account.id
        ? folders.find((folder) => folder.path === destination.folderPath)?.specialUse === '\\Archive'
        : false;
      scheduleAction(
        action === 'delete' ? 'Conversation deleted' : archive ? 'Conversation archived' : 'Conversation moved',
        () => performConversationAction(
          selection.account.id,
          selection.folder.path,
          conversation,
          action,
          destination,
          metadata,
        ),
        restoreConversation,
        setActionError,
        onFoldersChanged,
        [...keys],
      );
      return true;
    }

    try {
      const error = await performConversationAction(
        selection.account.id,
        selection.folder.path,
        conversation,
        action,
        destination,
        metadata,
      );
      if (error) {
        setActionError(error);
        if (patches) applyPatches(patches.revert);
        return false;
      }
      onFoldersChanged();
      return true;
    } catch {
      setActionError('The action could not be completed.');
      if (patches) applyPatches(patches.revert);
      return false;
    } finally {
      pendingActions.current.delete(conversation.id);
      setBusyConversations((current) => {
        const next = new Set(current);
        next.delete(conversation.id);
        return next;
      });
    }
  };

  useReadToggleShortcut(!selectedConversation, () => {
    const conversation = conversations.find((candidate) => candidate.id === selectionCursorId);
    if (!conversation) return false;
    const unread = conversation.messages.some(
      (message) => message.folderPath === selection.folder.path && message.unread,
    );
    void runAction(conversation, unread ? 'read' : 'unread');
    return true;
  });

  const runBulkAction = async (
    action: BulkMessageJobRequest['action'],
    destination?: MessageMoveDestination,
  ) => {
    if (bulkBusy) return;
    const uids = [
      ...new Set(
        selectedConversations.flatMap((conversation) =>
          conversation.messages
            .filter((message) => message.folderPath === selection.folder.path)
            .map((message) => message.uid),
        ),
      ),
    ];
    setBulkBusy(true);
    try {
      const result = await onStartBulkOperation(
        {
          action,
          groups: [{
            accountId: selection.account.id,
            folderPath: selection.folder.path,
            uids,
            ...(destination
              ? {
                  destinationAccountId: destination.accountId,
                  destinationPath: destination.folderPath,
                }
              : {}),
          }],
        },
        displayFolderName(selection.folder),
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

  const reader = selectedConversation ? (
      <ConversationReader
        accounts={accounts}
        key={selectedConversation.id}
        selection={selection}
        folders={folders}
        conversation={selectedConversation}
        onBack={() => {
          unreadReadingQueue.current = null;
          setReadingGroups(null);
          setReadingOrderIds(null);
          setSelectedConversation(null);
        }}
        navigationVariant={mailLayout === 'split' ? 'close' : 'back'}
        busy={busyConversations.has(selectedConversation.id)}
        actionError={actionError}
        onSetUnread={(unread) =>
          void runAction(selectedConversation, unread ? 'unread' : 'read')
        }
        onSetFlagged={(flagged) =>
          void runAction(selectedConversation, flagged ? 'star' : 'unstar')
        }
        supportsEmzeroKeywords={state.status === 'loaded' && state.supportsEmzeroKeywords}
        onSetImportant={(important, dueDate) =>
          void runAction(selectedConversation, important ? 'mark-important' : 'clear-important', undefined, { dueDate })
        }
        onSetColor={(color) => void runAction(selectedConversation, color ? 'set-color' : 'clear-color', undefined, { color })}
        onMove={(destination) =>
          void runAction(selectedConversation, 'move', destination)
        }
        onDelete={() => void runAction(selectedConversation, 'delete')}
        onReplySent={(message) => {
          setSelectedConversation((current) =>
            current ? conversationWithMessage(current, message) : current,
          );
          setState((current) => {
            if (current.status !== 'loaded') return current;
            const inSelectedFolder = message.folderPath === selection.folder.path;
            const target = inSelectedFolder ? current.messages : current.relatedMessages;
            const alreadyPresent = target.some(
              (candidate) =>
                candidate.folderPath === message.folderPath && candidate.uid === message.uid,
            );
            return {
              ...current,
              messages: inSelectedFolder
                ? [message, ...current.messages.filter((candidate) => candidate.uid !== message.uid)]
                : current.messages,
              relatedMessages: inSelectedFolder
                ? current.relatedMessages
                : [
                    message,
                    ...current.relatedMessages.filter(
                      (candidate) =>
                        candidate.folderPath !== message.folderPath || candidate.uid !== message.uid,
                    ),
                  ],
              total: current.total + (inSelectedFolder && !alreadyPresent ? 1 : 0),
            };
          });
        }}
        onDraftSaved={applyDraftSaved}
        onDraftDeleted={applyDraftDeleted}
      />
    ) : null;

  if (reader && mailLayout === 'list') {
    return reader;
  }

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
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {displayFolderName(selection.folder)}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {selection.account.name} · {selection.account.email}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MailViewMenu>
            <SidebarHeaderToggle pinned={sidebarPinned} onToggle={onToggleSidebar} />
            <MailLayoutToggle layout={mailLayout} onChange={onMailLayoutChange} />
            {isInbox && (
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
              {orderedConversations.length} {orderedConversations.length === 1 ? 'conversation' : 'conversations'}
              {' · '}
              {state.messages.length < state.total
                ? `newest ${state.messages.length} of ${state.total} messages`
                : `${state.total} ${state.total === 1 ? 'message' : 'messages'}`}
            </span>
          )}
          <Button
            variant="ghost"
            className="size-8 px-0"
            aria-label="Refresh messages"
            title="Refresh messages"
            disabled={state.status === 'loading' || refreshing}
            onClick={refresh}
          >
            <RefreshCw className={`size-4 ${state.status === 'loading' || refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {state.status === 'loading' && (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" />
            Fetching messages
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="grid flex-1 place-items-center p-8">
          <div className="max-w-md text-center">
            <CircleAlert className="mx-auto size-8 text-danger" />
            <h2 className="mt-3 font-semibold">Messages could not be loaded</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{state.message}</p>
            <Button className="mt-5" variant="secondary" onClick={refresh}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </div>
        </div>
      )}

      {state.status === 'loaded' && state.messages.length === 0 && (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Mail className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">This folder is empty</h2>
            <p className="mt-1 text-sm text-muted-foreground">There are no messages to show.</p>
          </div>
        </div>
      )}

      {state.status === 'loaded' && state.messages.length > 0 && orderedConversations.length === 0 && (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Mail className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No matching conversations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Try showing all mail or choosing another filter.
            </p>
          </div>
        </div>
      )}

      {state.status === 'loaded' && state.notice && (
        <div className="border-b border-border bg-secondary px-4 py-3 text-xs text-muted-foreground lg:px-6">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <p>{state.notice}</p>
          </div>
        </div>
      )}

      {state.status === 'loaded' && actionError && (
        <div className="border-b border-danger/20 bg-danger/8 px-4 py-3 text-xs text-danger lg:px-6">
          {actionError}
        </div>
      )}

      {state.status === 'loaded' && selectedConversationIds.size > 0 && (
        <BulkActionToolbar
          accounts={accounts}
          sourceAccountId={selection.account.id}
          folders={folders}
          sourcePath={selection.folder.path}
          selectedRows={selectedConversationIds.size}
          selectedEmails={selectedEmailCount}
          totalRows={conversations.length}
          busy={bulkBusy}
          permanentDelete={selection.folder.specialUse === '\\Trash'}
          onToggleAll={listSelection.toggleAll}
          onClear={listSelection.clear}
          onAction={(action) => void runBulkAction(action)}
          onMove={(destination) => void runBulkAction('move', destination)}
        />
      )}

      {state.status === 'loaded' && orderedConversations.length > 0 && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3" role="list" aria-label="Messages">
          <ConversationSections
            items={conversations}
            groupOf={groupOf}
            groupCounts={groupCounts}
            collapsedGroups={collapsedGroups.collapsed}
            onToggleGroup={collapsedGroups.toggle}
            dateOf={(conversation) => conversation.messages[0].sentAt ?? conversation.messages[0].receivedAt}
            keyOf={(conversation) => conversation.id}
            renderRow={(conversation) => {
              const facts = conversationRowFacts(conversation, selection.folder.path, selection.account, draftFolderPaths);
              const { unread, flagged, importantMessage, color } = facts;
              const prefetchTarget = {
                accountId: selection.account.id,
                folderPath: facts.latest.folderPath,
                uid: facts.latest.uid,
              };
              return (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  account={selection.account}
                  folderPath={selection.folder.path}
                  facts={facts}
                  compact={compactList}
                  showRecipients={showRecipients}
                  checked={selectedConversationIds.has(conversation.id)}
                  selectionActive={selectedConversationIds.size > 0}
                  open={mailLayout === 'split' && selectedConversation?.id === conversation.id}
                  rowRef={(node) => {
                    if (node) conversationRowRefs.current.set(conversation.id, node);
                    else conversationRowRefs.current.delete(conversation.id);
                  }}
                  prefetch={{
                    soon: () => prefetchSoon(prefetchTarget),
                    cancel: () => cancelPrefetch(prefetchTarget),
                  }}
                  onContextMenu={(event) => {
                    if (busyConversations.has(conversation.id)) return;
                    event.preventDefault();
                    setActionsMenuKey(conversation.id);
                  }}
                  onFocus={() => setSelectionCursorId(conversation.id)}
                  onToggleChecked={(shiftKey) => listSelection.toggleChecked(conversation.id, shiftKey)}
                  onClick={(event) => {
                    if (listSelection.handleModifierClick(event, conversation.id)) return;
                    setActionError(null);
                    const openedUnread = conversation.messages.some(
                      (message) => message.folderPath === selection.folder.path && message.unread,
                    );
                    unreadReadingQueue.current = openedUnread
                      ? conversations
                          .filter((candidate) => candidate.messages.some(
                            (message) => message.folderPath === selection.folder.path && message.unread,
                          ))
                          .map((candidate) => candidate.id)
                      : null;
                    setReadingOrderIds(orderedConversations.map((candidate) => candidate.id));
                    setReadingGroups(isInbox
                      ? new Map(orderedConversations.map((candidate) => [candidate.id, groupOf(candidate)]))
                      : null);
                    setSelectedConversation(conversation);
                  }}
                  actions={(
                    <ConversationActions
                      accounts={accounts}
                      sourceAccountId={selection.account.id}
                      folders={folders}
                      sourcePath={selection.folder.path}
                      messageCount={messageCountInFolder(conversation, selection.folder.path)}
                      unread={unread}
                      flagged={flagged}
                      important={Boolean(importantMessage)}
                      dueDate={importantMessage?.dueDate ?? null}
                      color={color}
                      supportsEmzeroKeywords={state.status === 'loaded' && state.supportsEmzeroKeywords}
                      busy={busyConversations.has(conversation.id)}
                      confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
                      subject={conversation.subject}
                      actionsOpen={actionsMenuKey === conversation.id}
                      onActionsOpenChange={(open) => setActionsMenuKey(open ? conversation.id : null)}
                      onSetUnread={(nextUnread) =>
                        void runAction(conversation, nextUnread ? 'unread' : 'read')
                      }
                      onSetFlagged={(nextFlagged) =>
                        void runAction(conversation, nextFlagged ? 'star' : 'unstar')
                      }
                      onSetImportant={(nextImportant, dueDate) =>
                        void runAction(conversation, nextImportant ? 'mark-important' : 'clear-important', undefined, { dueDate })
                      }
                      onSetColor={(nextColor) => void runAction(conversation, nextColor ? 'set-color' : 'clear-color', undefined, { color: nextColor })}
                      onMove={(destination) =>
                        void runAction(conversation, 'move', destination)
                      }
                      onDelete={() => void runAction(conversation, 'delete')}
                      deleteButtonRef={(node) => {
                        if (node) conversationDeleteButtonRefs.current.set(conversation.id, node);
                        else conversationDeleteButtonRefs.current.delete(conversation.id);
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
      reader={reader ?? <MailReaderPlaceholder icon={Mail} />}
    />
  );
}
