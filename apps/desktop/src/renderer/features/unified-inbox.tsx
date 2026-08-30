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
  type StartBulkOperation,
  type MailLayout,
  type UnifiedConversationItem,
  type UnifiedInboxLoadState,
  useCompactMailList,
} from './mail-common';
import { MailSplitLayout } from './mail-split-layout';
import { ConversationReader } from './conversation-reader';
import type { DraftSavedEvent } from './compose-dialog';
import { useMessagePrefetch } from './message-prefetch';
import { useUndoableAction } from './undoable-delete';
import type { DemoMailboxSnapshot } from './demo-mode';
import { useTheme } from '@/theme';

function demoLoadState(demo: DemoMailboxSnapshot): UnifiedInboxLoadState {
  const messageCount = demo.items.reduce(
    (total, item) => total + item.conversation.messages.length,
    0,
  );
  return {
    status: 'loaded',
    items: demo.items,
    failures: [],
    notices: [],
    loadedMessages: messageCount,
    totalMessages: messageCount,
  };
}

function conversationTime(conversation: MailConversation): number {
  const latest = conversation.messages[0];
  const value = latest?.sentAt ?? latest?.receivedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

export function UnifiedInbox({
  accounts,
  mailbox,
  onStartBulkOperation,
  mailLayout,
  onMailLayoutChange,
  sidebarPinned,
  onToggleSidebar,
  draftSavedEvent,
  demo,
}: {
  accounts: AccountSummary[];
  mailbox: 'inbox' | 'starred' | 'drafts' | 'trash';
  onStartBulkOperation: StartBulkOperation;
  mailLayout: MailLayout;
  onMailLayoutChange: (layout: MailLayout) => void;
  sidebarPinned: boolean;
  onToggleSidebar: () => void;
  draftSavedEvent?: DraftSavedEvent | null;
  demo?: DemoMailboxSnapshot;
}) {
  const { selectNextOnDelete } = useTheme();
  const title = demo?.title ?? {
    inbox: 'Inbox',
    starred: 'Starred',
    drafts: 'Drafts',
    trash: 'Trash',
  }[mailbox];
  const [state, setState] = useState<UnifiedInboxLoadState>(
    () => demo ? demoLoadState(demo) : { status: 'loading' },
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedItem, setSelectedItem] = useState<UnifiedConversationItem | null>(null);
  const pendingActions = useRef(new Set<string>());
  const [busyConversations, setBusyConversations] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);
  const [selectionCursorKey, setSelectionCursorKey] = useState<string | null>(null);
  const unifiedRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const unifiedDeleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingUnifiedFocusKey = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { scheduleAction, undoBar } = useUndoableAction();
  const { ref: listSurfaceRef, compact: compactList } = useCompactMailList(
    mailLayout === 'split',
  );

  useEffect(() => {
    if (demo) return;
    let active = true;
    void Promise.all(
      accounts.map(async (account) => {
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

          const loadedSources = sourceResults.map(({ folder, result }) => ({
            folder,
            messages: result.messages
              .filter((message) => mailbox !== 'starred' || message.flagged)
              .map((message) => ({ ...message, folderPath: folder.path })),
            total: mailbox === 'starred'
              ? result.messages.filter((message) => message.flagged).length
              : result.total,
            notice: result.message,
          }));
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
            items: loadedSources.flatMap(({ folder, messages }) => {
              const selection: FolderSelection = { kind: 'folder', account, folder };
              return groupMessagesWithRelated(
                messages,
                ['inbox', 'drafts'].includes(mailbox) ? relatedMessages : [],
              ).map((conversation) => ({
                selection,
                folders: folderResult.folders,
                conversation,
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
      }),
    ).then((results) => {
      if (!active) return;
      const items = results
        .flatMap((result) => ('items' in result && result.items ? result.items : []))
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
      setState({
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
      });
    });
    return () => {
      active = false;
    };
  }, [accounts, demo, mailbox, refreshKey, title]);

  const refresh = () => {
    setSelectedItem(null);
    setSelectedItemKeys(new Set());
    setSelectionAnchorKey(null);
    setSelectionCursorKey(null);
    setState(demo ? demoLoadState(demo) : { status: 'loading' });
    setRefreshKey((current) => current + 1);
  };

  const applyDraftSaved = useCallback(async (event: DraftSavedEvent) => {
    if (demo || !['inbox', 'drafts'].includes(mailbox)) return;
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
  }, [accounts, demo, mailbox]);

  useEffect(() => {
    if (!draftSavedEvent) return;
    const timer = window.setTimeout(() => void applyDraftSaved(draftSavedEvent), 0);
    return () => window.clearTimeout(timer);
  }, [applyDraftSaved, draftSavedEvent]);

  const itemKey = (item: UnifiedConversationItem) =>
    `${item.selection.account.id}:${item.conversation.id}`;
  const availableItems = useMemo(
    () => (state.status === 'loaded' ? state.items : []),
    [state],
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
  const { prefetchSoon, cancelPrefetch } = useMessagePrefetch(prefetchTargets, {
    disabled: Boolean(demo),
  });
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
      if (demo) return;
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
    [demo, mailbox],
  );

  const runAction = async (
    item: UnifiedConversationItem,
    action: ConversationAction,
    destination?: MessageMoveDestination,
  ) => {
    const key = itemKey(item);
    if (pendingActions.current.has(key)) return false;
    pendingActions.current.add(key);
    setBusyConversations((current) => new Set(current).add(key));
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

    if (demo) {
      if (action === 'read' || action === 'unread') {
        const unread = action === 'unread';
        updateUnread(new Map([...previousUnread.keys()].map((messageKey) => [messageKey, unread])));
      } else if (action === 'star' || action === 'unstar') {
        const flagged = action === 'star';
        updateFlagged(new Map([...previousFlagged.keys()].map((messageKey) => [messageKey, flagged])));
        if (mailbox === 'starred' && !flagged) {
          setState((current) => current.status === 'loaded'
            ? { ...current, items: current.items.filter((candidate) => itemKey(candidate) !== key) }
            : current);
          setSelectedItem(null);
        }
      } else {
        setState((current) => current.status === 'loaded'
          ? { ...current, items: current.items.filter((candidate) => itemKey(candidate) !== key) }
          : current);
        setSelectedItem(null);
      }
      pendingActions.current.delete(key);
      setBusyConversations((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      return true;
    }

    if (action === 'read' || action === 'unread') {
      const unread = action === 'unread';
      updateUnread(new Map([...previousUnread.keys()].map((messageKey) => [messageKey, unread])));
    }
    if (action === 'star' || action === 'unstar') {
      const flagged = action === 'star';
      updateFlagged(new Map([...previousFlagged.keys()].map((messageKey) => [messageKey, flagged])));
    }

    const previousState = state;
    const previousSelection = selectedItem;
    const removeItem = () => {
      let nextItem: UnifiedConversationItem | undefined;
      if (action === 'delete') {
        const removedIndex = availableItems.findIndex(
          (candidate) => itemKey(candidate) === key,
        );
        nextItem = removedIndex >= 0
          ? availableItems[removedIndex + 1] ?? availableItems[removedIndex - 1]
          : undefined;
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
      setSelectedItem(action === 'delete' && selectNextOnDelete ? (nextItem ?? null) : null);
    };
    const restoreItem = () => {
      setState(previousState);
      setSelectedItem(previousSelection);
    };

    if (action === 'delete' || action === 'move') {
      removeItem();
      pendingActions.current.delete(key);
      setBusyConversations((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
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
        ),
        restoreItem,
        setActionError,
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
      );
      if (error) {
        setActionError(error);
        if (action === 'read' || action === 'unread') updateUnread(previousUnread);
        if (action === 'star' || action === 'unstar') updateFlagged(previousFlagged);
        return false;
      }
      if (mailbox === 'starred' && action === 'unstar') removeItem();
      return true;
    } catch {
      setActionError('The action could not be completed.');
      if (action === 'read' || action === 'unread') updateUnread(previousUnread);
      if (action === 'star' || action === 'unstar') updateFlagged(previousFlagged);
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
    if (demo) {
      setSelectedItemKeys(new Set());
      setSelectionAnchorKey(null);
      setSelectionCursorKey(null);
      return;
    }
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
        onBack={() => setSelectedItem(null)}
        navigationVariant={mailLayout === 'split' ? 'close' : 'back'}
        busy={busyConversations.has(itemKey(selectedItem))}
        actionError={actionError}
        onSetUnread={(unread) =>
          void runAction(selectedItem, unread ? 'unread' : 'read')
        }
        onSetFlagged={(flagged) =>
          void runAction(selectedItem, flagged ? 'star' : 'unstar')
        }
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
        onDraftSent={refresh}
        demoDetails={demo?.details}
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
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SidebarHeaderToggle pinned={sidebarPinned} onToggle={onToggleSidebar} />
          <MailLayoutToggle layout={mailLayout} onChange={onMailLayoutChange} />
          {!compactList && state.status === 'loaded' && (
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground lg:inline">
              {state.items.length} {state.items.length === 1 ? 'conversation' : 'conversations'}
              {' · '}
              {state.loadedMessages < state.totalMessages
                ? `newest ${state.loadedMessages} of ${state.totalMessages} messages`
                : `${state.totalMessages} ${state.totalMessages === 1 ? 'message' : 'messages'}`}
            </span>
          )}
          <Button
            variant="ghost"
            className="px-3"
            aria-label={`Refresh ${title.toLowerCase()}`}
            title={`Refresh ${title.toLowerCase()}`}
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
          totalRows={state.items.length}
          busy={bulkBusy}
          permanentDelete={mailbox === 'trash'}
          onToggleAll={() => {
            const keys = state.items.map((item) => itemKey(item));
            if (selectedItemKeys.size === state.items.length) {
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

      {state.status === 'loaded' && state.items.length === 0 && (
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

      {state.status === 'loaded' && state.items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Messages">
          {state.items.map((item) => {
            const { conversation, selection } = item;
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
                key={`${selection.account.id}:${conversation.id}`}
                className={cn(
                  'group relative flex min-w-0 items-center border-b border-border hover:bg-accent/60',
                  selectedItemKeys.has(itemKey(item)) && 'bg-accent/60',
                  mailLayout === 'split' && selectedItem && itemKey(selectedItem) === itemKey(item) && 'bg-accent',
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
                      selectedItemKeys.size > 0
                        ? 'opacity-0'
                        : 'opacity-100 group-hover:opacity-0 group-focus-within:opacity-0',
                    )}
                  />
                  <SelectionCheckbox
                    checked={selectedItemKeys.has(itemKey(item))}
                    className={cn(
                      'transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                      'absolute inset-0 m-auto',
                      selectedItemKeys.size > 0
                        ? 'opacity-100'
                        : 'opacity-0 group-focus-within:opacity-100',
                    )}
                    label={`Select conversation: ${conversation.subject}`}
                    onChange={(shiftKey) => {
                      const keys = state.items.map((candidate) => itemKey(candidate));
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
                  />
                </div>
                <button
                  type="button"
                  ref={(node) => {
                    const key = itemKey(item);
                    if (node) unifiedRowRefs.current.set(key, node);
                    else unifiedRowRefs.current.delete(key);
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
                    setSelectionCursorKey(itemKey(item));
                    prefetchSoon(prefetchTarget);
                  }}
                  onBlur={() => cancelPrefetch(prefetchTarget)}
                  onClick={(event) => {
                    cancelPrefetch(prefetchTarget);
                    if (event.shiftKey) {
                      const keys = state.items.map((candidate) => itemKey(candidate));
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
                    setSelectedItem(item);
                  }}
                >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`}
                    aria-label={unread ? 'Contains unread messages' : 'Read'}
                  />
                  <span className={`truncate text-sm ${unread ? 'font-semibold' : ''}`}>
                    {opponent}
                  </span>
                </div>
                <div className={cn(
                  'flex min-w-0 items-center gap-2',
                  compactList
                    ? 'col-span-2 col-start-1 row-start-2 pl-3.5'
                    : 'col-span-2 col-start-1 row-start-2 pl-3.5 lg:col-auto lg:row-auto lg:pl-0',
                )}>
                  <span className="shrink-0 rounded bg-account px-1.5 py-0.5 text-[0.65rem] font-medium text-primary">
                    {selection.account.name}
                  </span>
                  <p className={`truncate text-sm ${unread ? 'font-semibold' : ''}`}>
                    {conversation.subject}
                    {conversation.messages.length > 1 && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        ({conversation.messages.length})
                      </span>
                    )}
                  </p>
                </div>
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
                    folders={item.folders}
                    sourcePath={selection.folder.path}
                    messageCount={messageCountInFolder(item.conversation, selection.folder.path)}
                    unread={unread}
                    flagged={flagged}
                    busy={busyConversations.has(itemKey(item))}
                    confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
                    onSetUnread={(nextUnread) =>
                      void runAction(item, nextUnread ? 'unread' : 'read')
                    }
                    onSetFlagged={(nextFlagged) =>
                      void runAction(item, nextFlagged ? 'star' : 'unstar')
                    }
                    onMove={(destination) => void runAction(item, 'move', destination)}
                    onDelete={() => void runAction(item, 'delete')}
                    deleteButtonRef={(node) => {
                      const key = itemKey(item);
                      if (node) unifiedDeleteButtonRefs.current.set(key, node);
                      else unifiedDeleteButtonRefs.current.delete(key);
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
          <div className={cn(
            'grid h-full place-items-center p-8 text-center text-muted-foreground',
            window.emzero?.platform === 'darwin' && 'macos-titlebar-drag',
          )}>
            <div>
              <Inbox className="mx-auto size-8" />
              <p className="mt-3 text-sm">Select a conversation to read it here.</p>
            </div>
          </div>
      )}
    />
  );
}
