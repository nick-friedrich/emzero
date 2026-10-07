import { MailViewMenu } from './mail-view-menu';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  CircleAlert,
  LoaderCircle,
  Search,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import {
  cn,
} from '@/lib/utils';
import {
  type AccountSummary,
  type MailFolderSummary,
  type MailSearchItem,
  type MessageMoveDestination,
  displayFolderName,
} from '../../shared/accounts';
import {
  groupMessagesWithRelated,
  type MailConversation,
} from '../../shared/conversations';
import {
  addressLabel,
  dueDateRowClass,
  conversationWithImportanceValues,
  conversationWithMessage,
  MailLayoutToggle,
  SidebarHeaderToggle,
  messageDate,
  performConversationAction,
  type ConversationAction,
  type FolderSelection,
  type MailLayout,
  useCompactMailList,
} from './mail-common';
import { tomorrowDateKey, type EmzeroMessageColor } from '../../shared/message-keywords';
import { MailSplitLayout } from './mail-split-layout';
import { ConversationReader } from './conversation-reader';
import { accountColorDotClass } from './account-colors';
import { useMessagePrefetch } from './message-prefetch';
import { useUndoableAction } from './undoable-delete';
import { useTheme } from '@/theme';

const specialFolderScopes = [
  { specialUse: '\\Inbox', label: 'Inbox' },
  { specialUse: '\\Sent', label: 'Sent' },
  { specialUse: '\\Drafts', label: 'Drafts' },
  { specialUse: '\\Archive', label: 'Archive' },
  { specialUse: '\\Trash', label: 'Trash' },
  { specialUse: '\\Junk', label: 'Spam' },
];

/** Encodes the folder filter as `special:<flag>` (any account) or `path:<path>` (one account). */
function folderScopeRequest(scope: string): { folderPath?: string; specialUse?: string } {
  if (scope.startsWith('special:')) return { specialUse: scope.slice('special:'.length) };
  if (scope.startsWith('path:')) return { folderPath: scope.slice('path:'.length) };
  return {};
}

function searchItemKey(item: MailSearchItem): string {
  return `${item.accountId}:${item.folder.path}:${item.message.uid}`;
}

type ServerSearchState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'done'; key: string; added: number; message?: string };

type SearchLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; items: MailSearchItem[] }
  | { status: 'error'; message: string };

export function MailSearch({
  accounts,
  initialQuery,
  mailLayout,
  onMailLayoutChange,
  sidebarPinned,
  onToggleSidebar,
  onFoldersChanged,
}: {
  accounts: AccountSummary[];
  initialQuery: string;
  mailLayout: MailLayout;
  onMailLayoutChange: (layout: MailLayout) => void;
  sidebarPinned: boolean;
  onToggleSidebar: () => void;
  onFoldersChanged: () => void;
}) {
  const { selectNextOnDelete } = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const [searchRequest, setSearchRequest] = useState({
    query: initialQuery.trim(),
    revision: 0,
  });
  const [accountId, setAccountId] = useState('');
  const [folderScope, setFolderScope] = useState('');
  const [scopeFolderState, setScopeFolderState] = useState<{
    accountId: string;
    folders: MailFolderSummary[];
  } | null>(null);
  const stateRef = useRef<SearchLoadState>({ status: 'idle' });
  const [sort, setSort] = useState<'relevance' | 'newest' | 'oldest'>('relevance');
  const [serverSearchState, setServerSearch] = useState<ServerSearchState>({ status: 'idle' });
  // A server search belongs to one query and filter set; changing either discards it.
  const searchKey = JSON.stringify([searchRequest.query, searchRequest.revision, accountId, folderScope, sort]);
  const searchKeyRef = useRef(searchKey);
  useEffect(() => {
    searchKeyRef.current = searchKey;
  }, [searchKey]);
  const serverSearch: ServerSearchState =
    serverSearchState.status !== 'idle' && serverSearchState.key === searchKey
      ? serverSearchState
      : { status: 'idle' };
  const [state, setState] = useState<SearchLoadState>(
    initialQuery.trim() ? { status: 'loading' } : { status: 'idle' },
  );
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [selected, setSelected] = useState<{
    item: MailSearchItem;
    conversation: MailConversation;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedFolderState, setSelectedFolderState] = useState<{
    accountId: string;
    folders: MailFolderSummary[];
  } | null>(null);
  const { scheduleAction, undoBar } = useUndoableAction();
  const { ref: listSurfaceRef, compact: compactList } = useCompactMailList(
    mailLayout === 'split',
  );
  const selectedAccountId = selected?.item.accountId ?? null;
  const selectedFolders = selectedFolderState?.accountId === selectedAccountId
    ? selectedFolderState.folders
    : [];
  const searchPrefetchTargets = useMemo(
    () =>
      state.status === 'loaded'
        ? state.items.map((item) => ({
            accountId: item.accountId,
            folderPath: item.folder.path,
            uid: item.message.uid,
          }))
        : [],
    [state],
  );
  const { prefetchSoon, cancelPrefetch } = useMessagePrefetch(searchPrefetchTargets, {
    warmNewest: false,
  });

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    void window.emzero.folders.list(accountId).then((result) => {
      if (active && result.ok) setScopeFolderState({ accountId, folders: result.folders });
    });
    return () => { active = false; };
  }, [accountId]);
  const scopeFolders = accountId && scopeFolderState?.accountId === accountId
    ? scopeFolderState.folders.filter((folder) => folder.selectable && !folder.specialUse)
    : [];

  useEffect(() => {
    if (!selectedAccountId) return;
    let active = true;
    void window.emzero.folders.list(selectedAccountId).then((result) => {
      if (active && result.ok) {
        setSelectedFolderState({ accountId: selectedAccountId, folders: result.folders });
      }
    });
    return () => { active = false; };
  }, [selectedAccountId]);

  useEffect(() => {
    const nextQuery = query.trim();
    const timer = window.setTimeout(() => {
      if (searchRequest.query === nextQuery) return;
      setState(nextQuery ? { status: 'loading' } : { status: 'idle' });
      setSelected(null);
      setSearchRequest((current) => ({ query: nextQuery, revision: current.revision }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, searchRequest.query]);

  useEffect(() => {
    if (!searchRequest.query) return;
    let active = true;
    void window.emzero.messages
      .search({
        query: searchRequest.query,
        accountId: accountId || undefined,
        ...folderScopeRequest(folderScope),
        limit: 100,
        sort,
      })
      .then((result) => {
        if (!active) return;
        setState(
          result.ok
            ? { status: 'loaded', items: result.items }
            : { status: 'error', message: result.message ?? 'Search could not be completed.' },
        );
      })
      .catch(() => {
        if (active) setState({ status: 'error', message: 'Search could not be completed.' });
      });
    return () => {
      active = false;
    };
  }, [accountId, folderScope, searchRequest, sort]);

  const runServerSearch = () => {
    if (!searchRequest.query || serverSearch.status === 'loading') return;
    const key = searchKey;
    setServerSearch({ status: 'loading', key });
    void window.emzero.messages
      .searchServer({
        query: searchRequest.query,
        accountId: accountId || undefined,
        ...folderScopeRequest(folderScope),
        limit: 200,
        sort,
      })
      .then((result) => {
        if (key !== searchKeyRef.current) return;
        const current = stateRef.current;
        if (!result.ok || current.status !== 'loaded') {
          setServerSearch({ status: 'done', key, added: 0, message: result.message ?? 'Server search failed.' });
          return;
        }
        const known = new Set(current.items.map(searchItemKey));
        const fresh = result.items.filter((item) => !known.has(searchItemKey(item)));
        setState({ status: 'loaded', items: [...current.items, ...fresh] });
        setServerSearch({ status: 'done', key, added: fresh.length, message: result.message });
      })
      .catch(() => {
        if (key !== searchKeyRef.current) return;
        setServerSearch({ status: 'done', key, added: 0, message: 'Server search failed.' });
      });
  };

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextQuery = query.trim();
    setState(nextQuery ? { status: 'loading' } : { status: 'idle' });
    setSelected(null);
    setSearchRequest((current) => ({ query: nextQuery, revision: current.revision + 1 }));
  };

  const reader = (() => {
    if (selected) {
    const account = accounts.find((candidate) => candidate.id === selected.item.accountId);
    if (account) {
      const selection: FolderSelection = {
        kind: 'folder',
        account,
        folder: selected.item.folder,
      };
      const runAction = async (
        action: ConversationAction,
        destination?: MessageMoveDestination,
        metadata?: { dueDate?: string; color?: EmzeroMessageColor | null },
      ) => {
        if (actionBusy) return;
        setActionBusy(true);
        setActionError(null);
        const previousState = state;
        const previousSelection = selected;
        const removeSelection = () => {
          const selectedIndex = state.status === 'loaded'
            ? state.items.findIndex((item) => item.accountId === selected.item.accountId && item.folder.path === selected.item.folder.path && item.message.uid === selected.item.message.uid)
            : -1;
          const nextItem = state.status === 'loaded' && selectedIndex >= 0
            ? state.items[selectedIndex + 1] ?? state.items[selectedIndex - 1]
            : undefined;
          setState((current) =>
            current.status === 'loaded'
              ? {
                  ...current,
                  items: current.items.filter(
                    (item) =>
                      item.accountId !== selected.item.accountId ||
                      item.folder.path !== selected.item.folder.path ||
                      item.message.uid !== selected.item.message.uid,
                  ),
                }
              : current,
          );
          const nextConversation = nextItem ? groupMessagesWithRelated([nextItem.message], [])[0] : undefined;
          setSelected(action === 'delete' && selectNextOnDelete && nextItem && nextConversation
            ? { item: nextItem, conversation: nextConversation }
            : null);
        };
        const restoreSelection = () => {
          setState(previousState);
          setSelected(previousSelection);
        };

        if (action === 'delete' || action === 'move') {
          removeSelection();
          setActionBusy(false);
          const archive = destination?.accountId === account.id
            ? selectedFolders.find((folder) => folder.path === destination.folderPath)?.specialUse === '\\Archive'
            : false;
          scheduleAction(
            action === 'delete' ? 'Conversation deleted' : archive ? 'Conversation archived' : 'Conversation moved',
            () => performConversationAction(
              account.id,
              selection.folder.path,
              selected.conversation,
              action,
              destination,
              metadata,
            ),
            restoreSelection,
            setActionError,
            onFoldersChanged,
          );
          return;
        }
        try {
          const error = await performConversationAction(
            account.id,
            selection.folder.path,
            selected.conversation,
            action,
            destination,
            metadata,
          );
          if (error) {
            setActionError(error);
            return;
          }
          onFoldersChanged();
          const isFlagAction = action === 'star' || action === 'unstar';
          const isImportanceAction = action === 'mark-important' || action === 'clear-important';
          const isColorAction = action === 'set-color' || action === 'clear-color';
          const nextValue = action === 'unread' || action === 'star';
          setSelected((current) =>
            current
              ? {
                  ...current,
                  conversation: isImportanceAction
                    ? conversationWithImportanceValues(
                        current.conversation,
                        new Map(current.conversation.messages
                          .filter((message) => message.folderPath === selection.folder.path)
                          .map((message) => [
                            `${message.folderPath}:${message.uid}`,
                            {
                              important: action === 'mark-important',
                              dueDate: action === 'mark-important'
                                ? (metadata?.dueDate ?? tomorrowDateKey())
                                : null,
                            },
                          ])),
                      )
                    : isColorAction
                      ? {
                          ...current.conversation,
                          messages: current.conversation.messages.map((message) =>
                            message.folderPath === selection.folder.path
                              ? { ...message, color: action === 'set-color' ? (metadata?.color ?? null) : null }
                              : message,
                          ),
                        }
                      : {
                    ...current.conversation,
                    messages: current.conversation.messages.map((message) =>
                      message.folderPath !== selection.folder.path
                        ? message
                        : isFlagAction
                          ? { ...message, flagged: nextValue }
                          : { ...message, unread: nextValue },
                    ),
                  },
                }
              : current,
          );
        } catch {
          setActionError('The action could not be completed.');
        } finally {
          setActionBusy(false);
        }
      };

      return (
        <>
        <ConversationReader
          key={`${selection.account.id}:${selection.folder.path}:${selected.conversation.id}`}
          accounts={accounts}
          selection={selection}
          folders={selectedFolders}
          conversation={selected.conversation}
          onBack={() => setSelected(null)}
          navigationVariant={mailLayout === 'split' ? 'close' : 'back'}
          busy={actionBusy}
          actionError={actionError}
          onSetUnread={(unread) => void runAction(unread ? 'unread' : 'read')}
          onSetFlagged={(flagged) => void runAction(flagged ? 'star' : 'unstar')}
          supportsEmzeroKeywords={Boolean(selected.item.folder.supportsEmzeroKeywords)}
          onSetImportant={(important, dueDate) => void runAction(important ? 'mark-important' : 'clear-important', undefined, { dueDate })}
          onSetColor={(color) => void runAction(color ? 'set-color' : 'clear-color', undefined, { color })}
          onMove={(destination) => void runAction('move', destination)}
          onDelete={() => void runAction('delete')}
          onReplySent={(message) => {
            setSelected((current) =>
              current
                ? { ...current, conversation: conversationWithMessage(current.conversation, message) }
                : current,
            );
          }}
          onDraftDeleted={() => {
            setSelected(null);
            setSearchRequest((current) => ({ ...current, revision: current.revision + 1 }));
          }}
        />
        {undoBar}
        </>
      );
    }
    }
    return null;
  })();

  if (reader && mailLayout === 'list') return reader;

  const serverScopeLabel = folderScope.startsWith('special:')
    ? specialFolderScopes.find((scope) => `special:${scope.specialUse}` === folderScope)?.label
    : folderScope.startsWith('path:')
      ? scopeFolders.find((folder) => `path:${folder.path}` === folderScope)?.name
      : null;
  const serverSearchControl = (
    <>
      {serverSearch.status === 'done' && (
        <span className={cn(serverSearch.message && 'text-danger')}>
          {serverSearch.message ??
            (serverSearch.added === 0
              ? 'No more messages on the server'
              : `${serverSearch.added} more from the server`)}
        </span>
      )}
      {serverSearch.status !== 'done' && (
        <Button
          type="button"
          variant="secondary"
          className="h-8 px-3 text-xs"
          disabled={serverSearch.status === 'loading'}
          onClick={runServerSearch}
        >
          {serverSearch.status === 'loading' ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          {serverScopeLabel ? `Search ${serverScopeLabel} on server` : 'Search on server'}
        </Button>
      )}
    </>
  );

  const list = (
    <section
      ref={listSurfaceRef}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      <header className={cn(
        'mail-pane-header border-b border-border/60 bg-card py-3 pl-16 pr-4 lg:px-6',
        compactList && 'lg:px-4',
        window.emzero?.platform === 'darwin' && 'macos-content-header macos-titlebar-drag',
      )}>
        <form
          className={cn(
            'mx-auto flex flex-wrap items-center gap-2',
            compactList ? 'max-w-none' : 'max-w-4xl',
          )}
          onSubmit={runSearch}
        >
          <label className={cn(
            'relative min-w-52 flex-1',
            compactList && 'basis-full',
          )}>
            <span className="sr-only">Search cached mail</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              autoFocus
              data-mail-search
              className="field search-field"
              type="search"
              value={query}
              placeholder="Search cached mail"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Account</span>
            <select
              className={cn(
                'field px-3 text-sm',
                compactList ? 'w-24 min-w-0' : 'min-w-36',
              )}
              value={accountId}
              onChange={(event) => {
                if (searchRequest.query) setState({ status: 'loading' });
                setSelected(null);
                setAccountId(event.target.value);
                if (folderScope.startsWith('path:')) setFolderScope('');
              }}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Folder</span>
            <select
              className={cn(
                'field px-3 text-sm',
                compactList ? 'w-24 min-w-0' : 'min-w-36',
              )}
              value={folderScope}
              onChange={(event) => {
                if (searchRequest.query) setState({ status: 'loading' });
                setSelected(null);
                setFolderScope(event.target.value);
              }}
            >
              <option value="">All folders</option>
              {specialFolderScopes.map((scope) => (
                <option key={scope.specialUse} value={`special:${scope.specialUse}`}>
                  {scope.label}
                </option>
              ))}
              {scopeFolders.length > 0 && (
                <optgroup label="Folders">
                  {scopeFolders.map((folder) => (
                    <option key={folder.path} value={`path:${folder.path}`}>
                      {displayFolderName(folder)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label>
            <span className="sr-only">Sort results</span>
            <select
              className={cn(
                'field px-3 text-sm',
                compactList ? 'w-24 min-w-0' : 'min-w-36',
              )}
              value={sort}
              onChange={(event) => {
                if (searchRequest.query) setState({ status: 'loading' });
                setSelected(null);
                setSort(event.target.value as typeof sort);
              }}
            >
              <option value="relevance">Most relevant</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <Button
            type="submit"
            className={compactList ? 'px-3' : undefined}
            disabled={!query.trim() || state.status === 'loading'}
          >
            {state.status === 'loading' ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            <span className={compactList ? 'sr-only' : undefined}>Search</span>
          </Button>
          <MailViewMenu>
            <SidebarHeaderToggle pinned={sidebarPinned} onToggle={onToggleSidebar} />
            <MailLayoutToggle layout={mailLayout} onChange={onMailLayoutChange} />
          </MailViewMenu>
        </form>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.status === 'idle' && (
          <div className="mx-auto max-w-xl px-6 py-20 text-center">
            <Search className="mx-auto size-9 text-muted-foreground" />
            <h1 className="mt-4 text-lg font-semibold">Search your cached mail</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Find subjects, senders, recipients, and message text already stored on this device.
            </p>
          </div>
        )}
        {state.status === 'loading' && (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" /> Searching cached mail
            </span>
          </div>
        )}
        {state.status === 'error' && (
          <div className="mx-auto max-w-xl px-6 py-20 text-center">
            <CircleAlert className="mx-auto size-9 text-danger" />
            <h1 className="mt-4 text-lg font-semibold">Search failed</h1>
            <p className="mt-2 text-sm text-danger">{state.message}</p>
          </div>
        )}
        {state.status === 'loaded' && state.items.length === 0 && (
          <div className="mx-auto max-w-xl px-6 py-20 text-center">
            <Search className="mx-auto size-9 text-muted-foreground" />
            <h1 className="mt-4 text-lg font-semibold">No cached messages found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Local search only includes mail already synced to this device and bodies you have
              opened. Folders like Trash may not be synced yet.
            </p>
            <div className="mt-5 flex flex-col items-center gap-2">{serverSearchControl}</div>
          </div>
        )}
        {state.status === 'loaded' && state.items.length > 0 && (
          <div className="px-2 pb-3" role="list" aria-label="Search results">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground lg:px-6">
              <span>
                {`${state.items.length} ${state.items.length === 1 ? 'result' : 'results'}`}
                {serverSearch.status === 'done' && !serverSearch.message
                  ? ' from cached mail and the server'
                  : ' from cached mail'}
              </span>
              <span className="flex flex-wrap items-center gap-2">{serverSearchControl}</span>
            </div>
            {state.items.map((item) => {
              const account = accounts.find((candidate) => candidate.id === item.accountId);
              const date = item.message.receivedAt ?? item.message.sentAt;
              const folderName = displayFolderName(item.folder);
              const isSpamFolder =
                item.folder.specialUse === '\\Junk' ||
                ['spam', 'junk'].includes(folderName.trim().toLowerCase());
              const prefetchTarget = {
                accountId: item.accountId,
                folderPath: item.folder.path,
                uid: item.message.uid,
              };
              return (
                <button
                  key={`${item.accountId}:${item.folder.path}:${item.message.uid}`}
                  type="button"
                  role="listitem"
                  className={cn(
                    'mail-search-row mb-1 grid w-full min-w-0 gap-y-1 rounded-xl text-left hover:bg-secondary/60 focus-visible:outline-none',
                    dueDateRowClass(item.message.important ? item.message.dueDate : null),
                    compactList
                      ? 'grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3.5'
                      : 'grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-3 lg:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] lg:px-6',
                    selected?.item.accountId === item.accountId &&
                      selected.item.folder.path === item.folder.path &&
                      selected.item.message.uid === item.message.uid && 'bg-primary/10',
                  )}
                  onMouseEnter={() => prefetchSoon(prefetchTarget)}
                  onMouseLeave={(event) => {
                    if (document.activeElement !== event.currentTarget) cancelPrefetch(prefetchTarget);
                  }}
                  onFocus={() => prefetchSoon(prefetchTarget)}
                  onBlur={() => cancelPrefetch(prefetchTarget)}
                  onClick={() => {
                    cancelPrefetch(prefetchTarget);
                    const conversation = groupMessagesWithRelated([item.message], [])[0];
                    if (conversation) setSelected({ item, conversation });
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('size-1.5 shrink-0 rounded-full', item.message.unread ? 'bg-primary' : 'bg-transparent')} />
                    <span className={cn('truncate text-sm', item.message.unread && 'font-semibold')}>
                      {addressLabel(item.message.from)}
                    </span>
                  </div>
                  <div className={cn(
                    'min-w-0',
                    compactList
                      ? 'col-span-2 col-start-1 row-start-2 pl-3.5'
                      : 'lg:row-span-2',
                    )}>
                    <p className={cn('truncate text-sm', item.message.unread && 'font-semibold')}>
                      {item.folder.specialUse === '\\Drafts' && (
                        <span className="mr-2 font-medium text-danger">Draft</span>
                      )}
                      {item.message.subject || '(No subject)'}
                    </p>
                    {item.snippet && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.snippet}</p>
                    )}
                  </div>
                  <time
                    className={cn(
                      'text-xs text-muted-foreground',
                      compactList && 'col-start-2 row-start-1',
                    )}
                    dateTime={date ?? undefined}
                  >
                    {messageDate(date)}
                  </time>
                  <p className={cn(
                    'truncate text-xs text-muted-foreground',
                    compactList
                      ? 'col-span-2 col-start-1 row-start-3 pl-3.5'
                      : 'col-span-2 pl-3.5 lg:col-span-1 lg:col-start-1 lg:pl-0',
                  )}>
                    {account && (
                      <span
                        className={cn('mr-1.5 inline-block size-2 rounded-full align-middle', accountColorDotClass(account.color))}
                        aria-hidden="true"
                      />
                    )}
                    {account?.name ?? 'Unknown account'} /{' '}
                    <span className={cn(
                      isSpamFolder && 'rounded-sm bg-yellow-400/40 px-1 py-0.5 text-foreground',
                    )}>
                      {folderName}
                    </span>
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
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
              <Search className="mx-auto size-8" />
              <p className="mt-3 text-sm">Select a message to read it here.</p>
            </div>
          </div>
      )}
    />
  );
}
