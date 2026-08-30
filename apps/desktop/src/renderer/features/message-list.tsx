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
  LoaderCircle,
  Mail,
  RefreshCw,
  Star,
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
  conversationAvatarUrl,
  ConversationActions,
  SelectionCheckbox,
  conversationOpponent,
  conversationWithMessage,
  conversationWithFlaggedValues,
  conversationWithUnreadValues,
  isEditableTarget,
  MailLayoutToggle,
  SidebarHeaderToggle,
  messageCountInFolder,
  messageDate,
  performConversationAction,
  SenderAvatar,
  type ConversationAction,
  type FolderSelection,
  type MessageLoadState,
  type MailLayout,
  type StartBulkOperation,
  useCompactMailList,
} from './mail-common';
import { MailSplitLayout } from './mail-split-layout';
import { ConversationReader } from './conversation-reader';
import type { DraftSavedEvent } from './compose-dialog';
import { useMessagePrefetch } from './message-prefetch';
import { useUndoableAction } from './undoable-delete';

export function MessageList({
  accounts,
  selection,
  onStartBulkOperation,
  mailLayout,
  onMailLayoutChange,
  sidebarPinned,
  onToggleSidebar,
  draftSavedEvent,
}: {
  accounts: AccountSummary[];
  selection: FolderSelection;
  onStartBulkOperation: StartBulkOperation;
  mailLayout: MailLayout;
  onMailLayoutChange: (layout: MailLayout) => void;
  sidebarPinned: boolean;
  onToggleSidebar: () => void;
  draftSavedEvent?: DraftSavedEvent | null;
}) {
  const [state, setState] = useState<MessageLoadState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedConversation, setSelectedConversation] = useState<MailConversation | null>(null);
  const pendingActions = useRef(new Set<string>());
  const [busyConversations, setBusyConversations] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectionCursorId, setSelectionCursorId] = useState<string | null>(null);
  const conversationRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const conversationDeleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingConversationFocusId = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [folders, setFolders] = useState<MailFolderSummary[]>([selection.folder]);
  const { scheduleAction, undoBar } = useUndoableAction();
  const { ref: listSurfaceRef, compact: compactList } = useCompactMailList(
    mailLayout === 'split',
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
      const result = await window.emzero.messages.list(
        selection.account.id,
        selection.folder.path,
        refreshKey > 0,
      );
      if (!result.ok) {
        if (active) {
          setState({ status: 'error', message: result.message ?? 'Could not load messages.' });
        }
        return;
      }
      const messages = result.messages.map((message) => ({
        ...message,
        folderPath: selection.folder.path,
      }));

      const relatedMessages: MailMessageSummary[] = [];
      const notices = [result.message];
      const folderResult = await window.emzero.folders.list(
        selection.account.id,
        refreshKey > 0,
      );
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
          relatedMessages.push(...relatedResult.messages.map((message) => ({
            ...message,
            folderPath: folder.path,
          })));
        }
      }

      if (active) {
        setState({
          status: 'loaded',
          messages,
          relatedMessages,
          total: result.total,
          notice: notices.filter(Boolean).join(' '),
        });
      }
    })()
      .catch(() => {
        if (active) setState({ status: 'error', message: 'Could not load messages.' });
      });
    return () => {
      active = false;
    };
  }, [refreshKey, selection.account.id, selection.folder.path, selection.folder.specialUse]);

  const refresh = () => {
    setSelectedConversationIds(new Set());
    setSelectionAnchorId(null);
    setSelectionCursorId(null);
    setState({ status: 'loading' });
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

  useEffect(() => {
    if (!draftSavedEvent) return;
    const timer = window.setTimeout(() => void applyDraftSaved(draftSavedEvent), 0);
    return () => window.clearTimeout(timer);
  }, [applyDraftSaved, draftSavedEvent]);

  const showRecipients = selection.folder.specialUse === '\\Sent';
  const conversations = useMemo(
    () =>
      state.status === 'loaded'
        ? groupMessagesWithRelated(state.messages, state.relatedMessages)
        : [],
    [state],
  );
  useEffect(() => {
    const pendingId = pendingConversationFocusId.current;
    if (!pendingId) return;
    const row = conversationRowRefs.current.get(pendingId);
    if (!row) return;
    pendingConversationFocusId.current = null;
    row.focus();
  }, [conversations]);
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

  useEffect(() => {
    if (selectedConversation) return;
    const handleSelectionShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (event.key === 'Escape' && selectedConversationIds.size > 0) {
        event.preventDefault();
        setSelectedConversationIds(new Set());
        setSelectionAnchorId(null);
        setSelectionCursorId(null);
        return;
      }
      if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSelectedConversationIds(new Set(conversations.map((conversation) => conversation.id)));
        setSelectionAnchorId(conversations[0]?.id ?? null);
        setSelectionCursorId(conversations.at(-1)?.id ?? null);
        return;
      }
      const keys = conversations.map((conversation) => conversation.id);
      const cursorIndex = selectionCursorId ? keys.indexOf(selectionCursorId) : -1;
      const cursorConversation = cursorIndex >= 0 ? conversations[cursorIndex] : undefined;
      if (event.key === 'Delete' && cursorConversation) {
        event.preventDefault();
        conversationDeleteButtonRefs.current.get(cursorConversation.id)?.click();
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
        setSelectionCursorId(keys[nextIndex]);
        conversationRowRefs.current.get(keys[nextIndex])?.focus();
        return;
      }
      if (!event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || conversations.length === 0) return;
      event.preventDefault();
      let rangeCursorIndex = selectionCursorId
        ? keys.indexOf(selectionCursorId)
        : keys.findIndex((key) => selectedConversationIds.has(key));
      if (rangeCursorIndex < 0) rangeCursorIndex = event.key === 'ArrowDown' ? 0 : keys.length - 1;
      const anchorIndex = selectionAnchorId ? keys.indexOf(selectionAnchorId) : rangeCursorIndex;
      const nextIndex = Math.max(
        0,
        Math.min(keys.length - 1, rangeCursorIndex + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      const safeAnchorIndex = anchorIndex < 0 ? rangeCursorIndex : anchorIndex;
      setSelectedConversationIds(keysInRange(keys, safeAnchorIndex, nextIndex));
      setSelectionAnchorId(keys[safeAnchorIndex]);
      setSelectionCursorId(keys[nextIndex]);
      conversationRowRefs.current.get(keys[nextIndex])?.focus();
    };
    window.addEventListener('keydown', handleSelectionShortcut);
    return () => window.removeEventListener('keydown', handleSelectionShortcut);
  }, [conversations, selectedConversation, selectedConversationIds, selectionAnchorId, selectionCursorId]);

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
  ) => {
    if (pendingActions.current.has(conversation.id)) return false;
    pendingActions.current.add(conversation.id);
    setBusyConversations((current) => new Set(current).add(conversation.id));
    setActionError(null);
    const keys = new Set(
      conversation.messages
        .filter((message) => message.folderPath === selection.folder.path)
        .map((message) => `${message.folderPath}:${message.uid}`),
    );
    const previousUnread = new Map(
      conversation.messages
        .filter((message) => keys.has(`${message.folderPath}:${message.uid}`))
        .map((message) => [`${message.folderPath}:${message.uid}`, message.unread]),
    );
    const previousFlagged = new Map(
      conversation.messages
        .filter((message) => keys.has(`${message.folderPath}:${message.uid}`))
        .map((message) => [`${message.folderPath}:${message.uid}`, message.flagged]),
    );
    const updateUnread = (unreadByMessage: ReadonlyMap<string, boolean>) => {
      const update = (message: MailMessageSummary) => {
        const unread = unreadByMessage.get(`${message.folderPath}:${message.uid}`);
        return unread === undefined ? message : { ...message, unread };
      };
      setState((current) =>
        current.status === 'loaded'
          ? {
              ...current,
              messages: current.messages.map(update),
              relatedMessages: current.relatedMessages.map(update),
            }
          : current,
      );
      setSelectedConversation((current) =>
        current?.id === conversation.id
          ? conversationWithUnreadValues(current, unreadByMessage)
          : current,
      );
    };
    const updateFlagged = (flaggedByMessage: ReadonlyMap<string, boolean>) => {
      const update = (message: MailMessageSummary) => {
        const flagged = flaggedByMessage.get(`${message.folderPath}:${message.uid}`);
        return flagged === undefined ? message : { ...message, flagged };
      };
      setState((current) =>
        current.status === 'loaded'
          ? {
              ...current,
              messages: current.messages.map(update),
              relatedMessages: current.relatedMessages.map(update),
            }
          : current,
      );
      setSelectedConversation((current) =>
        current?.id === conversation.id
          ? conversationWithFlaggedValues(current, flaggedByMessage)
          : current,
      );
    };

    if (action === 'read' || action === 'unread') {
      const unread = action === 'unread';
      updateUnread(new Map([...keys].map((key) => [key, unread])));
    }
    if (action === 'star' || action === 'unstar') {
      const flagged = action === 'star';
      updateFlagged(new Map([...keys].map((key) => [key, flagged])));
    }

    const previousState = state;
    const previousSelection = selectedConversation;
    const removeConversation = () => {
      if (action === 'delete') {
        const removedIndex = conversations.findIndex(
          (candidate) => candidate.id === conversation.id,
        );
        const nextConversation = removedIndex >= 0
          ? conversations[removedIndex + 1] ?? conversations[removedIndex - 1]
          : undefined;
        const nextId = nextConversation?.id ?? null;
        pendingConversationFocusId.current = nextId;
        setSelectionCursorId(nextId);
      }
      setState((current) =>
        current.status === 'loaded'
          ? {
              ...current,
              messages: current.messages.filter(
                (message) => !keys.has(`${message.folderPath}:${message.uid}`),
              ),
              relatedMessages: current.relatedMessages.filter(
                (message) => !keys.has(`${message.folderPath}:${message.uid}`),
              ),
              total: Math.max(
                0,
                current.total -
                  current.messages.filter((message) =>
                    keys.has(`${message.folderPath}:${message.uid}`),
                  ).length,
              ),
            }
          : current,
      );
      setSelectedConversation(null);
    };
    const restoreConversation = () => {
      setState(previousState);
      setSelectedConversation(previousSelection);
    };

    if (action === 'delete' || action === 'move') {
      removeConversation();
      pendingActions.current.delete(conversation.id);
      setBusyConversations((current) => {
        const next = new Set(current);
        next.delete(conversation.id);
        return next;
      });
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
        ),
        restoreConversation,
        setActionError,
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
      );
      if (error) {
        setActionError(error);
        if (action === 'read' || action === 'unread') updateUnread(previousUnread);
        if (action === 'star' || action === 'unstar') updateFlagged(previousFlagged);
        return false;
      }
      return true;
    } catch {
      setActionError('The action could not be completed.');
      if (action === 'read' || action === 'unread') updateUnread(previousUnread);
      if (action === 'star' || action === 'unstar') updateFlagged(previousFlagged);
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

  const runShortcutAction = useEffectEvent(runAction);

  useEffect(() => {
    if (selectedConversation) return;
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
      const conversation = conversations.find(
        (candidate) => candidate.id === selectionCursorId,
      );
      if (!conversation) return;
      event.preventDefault();
      const unread = conversation.messages.some(
        (message) => message.folderPath === selection.folder.path && message.unread,
      );
      void runShortcutAction(conversation, unread ? 'read' : 'unread');
    };
    window.addEventListener('keydown', handleReadShortcut);
    return () => window.removeEventListener('keydown', handleReadShortcut);
  }, [conversations, selectedConversation, selection.folder.path, selectionCursorId]);

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
        setSelectedConversationIds(new Set());
        setSelectionAnchorId(null);
        setSelectionCursorId(null);
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
        onBack={() => setSelectedConversation(null)}
        navigationVariant={mailLayout === 'split' ? 'close' : 'back'}
        busy={busyConversations.has(selectedConversation.id)}
        actionError={actionError}
        onSetUnread={(unread) =>
          void runAction(selectedConversation, unread ? 'unread' : 'read')
        }
        onSetFlagged={(flagged) =>
          void runAction(selectedConversation, flagged ? 'star' : 'unstar')
        }
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
        onDraftSent={refresh}
      />
    ) : null;

  if (reader && mailLayout === 'list') {
    return reader;
  }

  const list = (
    <section
      ref={listSurfaceRef}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
    >
      <header className={cn(
        'flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card py-4 pl-16 pr-4 lg:px-6',
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
        <div className="flex items-center gap-3">
          <SidebarHeaderToggle pinned={sidebarPinned} onToggle={onToggleSidebar} />
          <MailLayoutToggle layout={mailLayout} onChange={onMailLayoutChange} />
          {!compactList && state.status === 'loaded' && (
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground lg:inline">
              {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
              {' · '}
              {state.messages.length < state.total
                ? `newest ${state.messages.length} of ${state.total} messages`
                : `${state.total} ${state.total === 1 ? 'message' : 'messages'}`}
            </span>
          )}
          <Button
            variant="ghost"
            className="px-3"
            aria-label="Refresh messages"
            title="Refresh messages"
            disabled={state.status === 'loading'}
            onClick={refresh}
          >
            <RefreshCw className={`size-4 ${state.status === 'loading' ? 'animate-spin' : ''}`} />
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
          onToggleAll={() => {
            if (selectedConversationIds.size === conversations.length) {
              setSelectedConversationIds(new Set());
              setSelectionAnchorId(null);
              setSelectionCursorId(null);
            } else {
              setSelectedConversationIds(new Set(conversations.map((conversation) => conversation.id)));
              setSelectionAnchorId(conversations[0]?.id ?? null);
              setSelectionCursorId(conversations.at(-1)?.id ?? null);
            }
          }}
          onClear={() => {
            setSelectedConversationIds(new Set());
            setSelectionAnchorId(null);
            setSelectionCursorId(null);
          }}
          onAction={(action) => void runBulkAction(action)}
          onMove={(destination) => void runBulkAction('move', destination)}
        />
      )}

      {state.status === 'loaded' && state.messages.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Messages">
          {conversations.map((conversation) => {
            const latest = conversation.messages[0];
            const prefetchTarget = {
              accountId: selection.account.id,
              folderPath: latest.folderPath,
              uid: latest.uid,
            };
            const opponent = conversationOpponent(conversation.messages, selection.account);
            const date = latest.sentAt ?? latest.receivedAt;
            const unread = conversation.messages.some(
              (message) => message.folderPath === selection.folder.path && message.unread,
            );
            const flagged = conversation.messages.some((message) => message.flagged);
            return (
              <div
                key={conversation.id}
                className={cn(
                  'group relative flex min-w-0 items-center border-b border-border hover:bg-accent/60',
                  selectedConversationIds.has(conversation.id) && 'bg-accent/60',
                  mailLayout === 'split' && selectedConversation?.id === conversation.id && 'bg-accent',
                )}
                role="listitem"
              >
                <div
                  className={compactList
                    ? 'relative ml-3 grid size-8 shrink-0 place-items-center'
                    : 'relative ml-4 grid size-8 shrink-0 place-items-center lg:ml-6'}
                  onClick={(event) => event.stopPropagation()}
                >
                  <SenderAvatar
                    label={opponent}
                    imageUrl={conversationAvatarUrl(conversation.messages, selection.account)}
                    className={cn(
                      selectedConversationIds.size > 0
                        ? 'opacity-0'
                        : 'opacity-100 group-hover:opacity-0 group-focus-within:opacity-0',
                    )}
                  />
                  <SelectionCheckbox
                    checked={selectedConversationIds.has(conversation.id)}
                    className={cn(
                      'transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                      'absolute inset-0 m-auto',
                      selectedConversationIds.size > 0
                        ? 'opacity-100'
                        : 'opacity-0 group-focus-within:opacity-100',
                    )}
                    label={`Select conversation: ${conversation.subject}`}
                    onChange={(shiftKey) => {
                      const keys = conversations.map((candidate) => candidate.id);
                      const targetIndex = keys.indexOf(conversation.id);
                      const anchorIndex = selectionAnchorId ? keys.indexOf(selectionAnchorId) : -1;
                      if (shiftKey && anchorIndex >= 0) {
                        setSelectedConversationIds(keysInRange(keys, anchorIndex, targetIndex));
                      } else {
                        setSelectedConversationIds((current) => {
                        const next = new Set(current);
                        if (next.has(conversation.id)) next.delete(conversation.id);
                        else next.add(conversation.id);
                        return next;
                        });
                        setSelectionAnchorId(conversation.id);
                      }
                      setSelectionCursorId(conversation.id);
                    }}
                  />
                </div>
                <button
                  type="button"
                  ref={(node) => {
                    if (node) conversationRowRefs.current.set(conversation.id, node);
                    else conversationRowRefs.current.delete(conversation.id);
                  }}
                  className={cn(
                    'grid min-w-0 flex-1 items-center gap-y-1 text-left focus-visible:bg-accent focus-visible:outline-none',
                    compactList
                      ? 'grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-3.5'
                      : 'grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3 lg:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] lg:gap-4 lg:px-6',
                  )}
                  onMouseEnter={() => prefetchSoon(prefetchTarget)}
                  onMouseLeave={(event) => {
                    if (document.activeElement !== event.currentTarget) cancelPrefetch(prefetchTarget);
                  }}
                  onFocus={() => {
                    setSelectionCursorId(conversation.id);
                    prefetchSoon(prefetchTarget);
                  }}
                  onBlur={() => cancelPrefetch(prefetchTarget)}
                  onClick={(event) => {
                    cancelPrefetch(prefetchTarget);
                    if (event.shiftKey) {
                      const keys = conversations.map((candidate) => candidate.id);
                      const targetIndex = keys.indexOf(conversation.id);
                      const anchorIndex = selectionAnchorId ? keys.indexOf(selectionAnchorId) : targetIndex;
                      setSelectedConversationIds(keysInRange(keys, anchorIndex, targetIndex));
                      setSelectionAnchorId(keys[anchorIndex]);
                      setSelectionCursorId(conversation.id);
                      return;
                    }
                    if (event.ctrlKey || event.metaKey) {
                      setSelectedConversationIds((current) => {
                        const next = new Set(current);
                        if (next.has(conversation.id)) next.delete(conversation.id);
                        else next.add(conversation.id);
                        return next;
                      });
                      setSelectionAnchorId(conversation.id);
                      setSelectionCursorId(conversation.id);
                      return;
                    }
                    setActionError(null);
                    setSelectedConversation(conversation);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`}
                      aria-label={unread ? 'Contains unread messages' : 'Read'}
                    />
                    <span className={`truncate text-sm ${unread ? 'font-semibold' : ''}`}>
                      {showRecipients ? `To: ${opponent}` : opponent}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'min-w-0 truncate text-sm',
                      unread && 'font-semibold',
                      compactList
                        ? 'col-span-2 col-start-1 row-start-2 pl-3.5'
                        : 'col-span-2 col-start-1 row-start-2 pl-3.5 lg:col-auto lg:row-auto lg:pl-0',
                    )}
                  >
                    {conversation.subject}
                    {conversation.messages.length > 1 && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        ({conversation.messages.length})
                      </span>
                    )}
                  </p>
                  <div className={cn(
                    'flex items-center gap-2 text-xs text-muted-foreground',
                    compactList
                      ? 'col-start-2 row-start-1'
                      : 'col-start-2 row-start-1 lg:col-auto lg:row-auto',
                  )}>
                    {flagged && (
                      <Star className="size-3.5 fill-primary text-primary" aria-label="Flagged" />
                    )}
                    <time dateTime={date ?? undefined}>{messageDate(date)}</time>
                  </div>
                </button>
                <div className={cn(
                  compactList
                    ? 'absolute bottom-1.5 right-2 z-10 rounded-md border border-border bg-card p-0.5 opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-within:opacity-100'
                    : 'pr-3 lg:pr-5',
                )}>
                  <ConversationActions
                    accounts={accounts}
                    sourceAccountId={selection.account.id}
                    folders={folders}
                    sourcePath={selection.folder.path}
                    messageCount={messageCountInFolder(conversation, selection.folder.path)}
                    unread={unread}
                    flagged={flagged}
                    busy={busyConversations.has(conversation.id)}
                    confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
                    onSetUnread={(nextUnread) =>
                      void runAction(conversation, nextUnread ? 'unread' : 'read')
                    }
                    onSetFlagged={(nextFlagged) =>
                      void runAction(conversation, nextFlagged ? 'star' : 'unstar')
                    }
                    onMove={(destination) =>
                      void runAction(conversation, 'move', destination)
                    }
                    onDelete={() => void runAction(conversation, 'delete')}
                    deleteButtonRef={(node) => {
                      if (node) conversationDeleteButtonRefs.current.set(conversation.id, node);
                      else conversationDeleteButtonRefs.current.delete(conversation.id);
                    }}
                  />
                </div>
              </div>
            );
          })}
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
          <div className="grid h-full place-items-center p-8 text-center text-muted-foreground">
            <div>
              <Mail className="mx-auto size-8" />
              <p className="mt-3 text-sm">Select a conversation to read it here.</p>
            </div>
          </div>
      )}
    />
  );
}
