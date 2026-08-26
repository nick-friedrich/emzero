import {
  useEffect,
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
  conversationWithMessage,
  messageDate,
  performConversationAction,
  type ConversationAction,
  type FolderSelection,
} from './mail-common';
import { ConversationReader } from './conversation-reader';
import { useUndoableDelete } from './undoable-delete';

type SearchLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; items: MailSearchItem[] }
  | { status: 'error'; message: string };

export function MailSearch({
  accounts,
  initialQuery,
}: {
  accounts: AccountSummary[];
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [searchRequest, setSearchRequest] = useState({
    query: initialQuery.trim(),
    revision: 0,
  });
  const [accountId, setAccountId] = useState('');
  const [sort, setSort] = useState<'relevance' | 'newest' | 'oldest'>('relevance');
  const [state, setState] = useState<SearchLoadState>(
    initialQuery.trim() ? { status: 'loading' } : { status: 'idle' },
  );
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
  const { scheduleDelete, undoBar } = useUndoableDelete();
  const selectedAccountId = selected?.item.accountId ?? null;
  const selectedFolders = selectedFolderState?.accountId === selectedAccountId
    ? selectedFolderState.folders
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
  }, [accountId, searchRequest, sort]);

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextQuery = query.trim();
    setState(nextQuery ? { status: 'loading' } : { status: 'idle' });
    setSelected(null);
    setSearchRequest((current) => ({ query: nextQuery, revision: current.revision + 1 }));
  };

  if (selected) {
    const account = accounts.find((candidate) => candidate.id === selected.item.accountId);
    if (account) {
      const selection: FolderSelection = {
        kind: 'folder',
        account,
        folder: selected.item.folder,
      };
      const runAction = async (action: ConversationAction, destination?: MessageMoveDestination) => {
        if (actionBusy) return;
        setActionBusy(true);
        setActionError(null);
        const previousState = state;
        const previousSelection = selected;
        const removeSelection = () => {
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
          setSelected(null);
        };
        const restoreSelection = () => {
          setState(previousState);
          setSelected(previousSelection);
        };

        if (action === 'delete') {
          removeSelection();
          setActionBusy(false);
          scheduleDelete(
            () => performConversationAction(
              account.id,
              selection.folder.path,
              selected.conversation,
              action,
              destination,
            ),
            restoreSelection,
            setActionError,
          );
          return;
        }
        if (action === 'move') removeSelection();
        try {
          const error = await performConversationAction(
            account.id,
            selection.folder.path,
            selected.conversation,
            action,
            destination,
          );
          if (error) {
            setActionError(error);
            if (action === 'move') restoreSelection();
            return;
          }
          if (action !== 'move') {
            const isFlagAction = action === 'star' || action === 'unstar';
            const nextValue = action === 'unread' || action === 'star';
            setSelected((current) =>
              current
                ? {
                    ...current,
                    conversation: {
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
          }
        } catch {
          setActionError('The action could not be completed.');
          if (action === 'move') restoreSelection();
        } finally {
          setActionBusy(false);
        }
      };

      return (
        <>
        <ConversationReader
          accounts={accounts}
          selection={selection}
          folders={selectedFolders}
          conversation={selected.conversation}
          onBack={() => setSelected(null)}
          busy={actionBusy}
          actionError={actionError}
          onSetUnread={(unread) => void runAction(unread ? 'unread' : 'read')}
          onSetFlagged={(flagged) => void runAction(flagged ? 'star' : 'unstar')}
          onMove={(destination) => void runAction('move', destination)}
          onDelete={() => void runAction('delete')}
          onReplySent={(message) => {
            setSelected((current) =>
              current
                ? { ...current, conversation: conversationWithMessage(current.conversation, message) }
                : current,
            );
          }}
        />
        {undoBar}
        </>
      );
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-card py-3 pl-16 pr-4 lg:px-6">
        <form className="mx-auto flex max-w-4xl flex-wrap items-center gap-2" onSubmit={runSearch}>
          <label className="relative min-w-52 flex-1">
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
              className="field min-w-36 px-3 text-sm"
              value={accountId}
              onChange={(event) => {
                if (searchRequest.query) setState({ status: 'loading' });
                setSelected(null);
                setAccountId(event.target.value);
              }}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Sort results</span>
            <select
              className="field min-w-36 px-3 text-sm"
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
          <Button type="submit" disabled={!query.trim() || state.status === 'loading'}>
            {state.status === 'loading' ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
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
              Search only includes mail already synced to this device and bodies you have opened.
            </p>
          </div>
        )}
        {state.status === 'loaded' && state.items.length > 0 && (
          <div role="list" aria-label="Search results">
            <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground lg:px-6">
              {state.items.length === 100 ? 'First 100 results' : `${state.items.length} ${state.items.length === 1 ? 'result' : 'results'}`}
              {' '}from cached mail
            </div>
            {state.items.map((item) => {
              const account = accounts.find((candidate) => candidate.id === item.accountId);
              const date = item.message.receivedAt ?? item.message.sentAt;
              return (
                <button
                  key={`${item.accountId}:${item.folder.path}:${item.message.uid}`}
                  type="button"
                  role="listitem"
                  className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none lg:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] lg:px-6"
                  onClick={() => {
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
                  <div className="min-w-0 lg:row-span-2">
                    <p className={cn('truncate text-sm', item.message.unread && 'font-semibold')}>
                      {item.message.subject || '(No subject)'}
                    </p>
                    {item.snippet && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.snippet}</p>
                    )}
                  </div>
                  <time className="text-xs text-muted-foreground" dateTime={date ?? undefined}>
                    {messageDate(date)}
                  </time>
                  <p className="col-span-2 truncate pl-3.5 text-xs text-muted-foreground lg:col-span-1 lg:col-start-1 lg:pl-0">
                    {account?.name ?? 'Unknown account'} / {displayFolderName(item.folder)}
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
}
