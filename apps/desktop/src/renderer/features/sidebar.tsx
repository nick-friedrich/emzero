import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  GripVertical,
  Inbox,
  LoaderCircle,
  PenLine,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  cn,
} from '@/lib/utils';
import {
  type AccountSummary,
  type MailFolderSummary,
  type MailSyncStatus,
  type FolderMutationResult,
  type FolderDropMode,
  accountUnreadCount,
  displayFolderName,
  findInboxFolder,
  folderMoveRequestForDrop,
  inboxUnreadCount,
  manageableFolder,
  optimisticFolderMove,
  orderedFolderTree,
  visibleFolderTree,
} from '../../shared/accounts';
import emzeroLogoUrl from '../../../assets/emzero-logo-header.webp';
import { Field } from './form-field';
import {
  FolderIcon,
  UnreadBadge,
  joinedFolderPath,
  messageDate,
  type FolderLoadState,
  type MailboxSelection,
} from './mail-common';

type FolderEditorState =
  | { kind: 'create'; account: AccountSummary; parentPath: string }
  | { kind: 'rename'; account: AccountSummary; folder: MailFolderSummary };

function FolderEditorDialog({
  state,
  folders,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  state: FolderEditorState;
  folders: MailFolderSummary[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string, parentPath: string) => void;
}) {
  const [name, setName] = useState(state.kind === 'rename' ? state.folder.name : '');
  const [parentPath, setParentPath] = useState(
    state.kind === 'create' ? state.parentPath : state.folder.parentPath,
  );
  const create = state.kind === 'create';

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{create ? 'Create folder' : 'Rename folder'}</DialogTitle>
          <DialogDescription>
            {create
              ? `Add a mail folder to ${state.account.name}.`
              : `Change the name of ${state.folder.name}.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-2 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onSubmit(name, parentPath);
          }}
        >
          <Field label="Folder name">
            <input
              autoFocus
              className="field"
              value={name}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {create && (
            <Field label="Location">
              <select
                className="field"
                value={parentPath}
                disabled={busy}
                onChange={(event) => setParentPath(event.target.value)}
              >
                <option value="">Top level</option>
                {orderedFolderTree(folders).map((folder) => (
                  <option key={folder.path} value={folder.path}>{folder.path}</option>
                ))}
              </select>
            </Field>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {create ? 'Create' : 'Rename'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type FolderDropTarget = {
  accountId: string;
  folderPath: string | null;
  mode: FolderDropMode;
};

export function Sidebar({
  accounts,
  selection,
  syncStatus,
  syncRevision,
  onSelect,
  onAdd,
  onManage,
  onReorder,
  onCompose,
  pinned,
  onPinnedChange,
  demoMode,
  demoFolderMap,
  onDemoModeChange,
  className,
}: {
  accounts: AccountSummary[];
  selection: MailboxSelection;
  syncStatus: MailSyncStatus;
  syncRevision: number;
  onSelect: (selection: MailboxSelection) => void;
  onAdd: () => void;
  onManage: () => void;
  onReorder: (accountIds: string[]) => Promise<boolean>;
  onCompose: () => void;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  demoMode: boolean;
  demoFolderMap?: Record<string, MailFolderSummary[]>;
  onDemoModeChange: (enabled: boolean) => void;
  className?: string;
}) {
  const demoClickTimes = useRef<number[]>([]);
  const [expanded, setExpanded] = useState(
    () => new Set(demoMode ? accounts.map((account) => account.id) : []),
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, Set<string>>>({});
  const [folderStates, setFolderStates] = useState<Record<string, FolderLoadState>>({});
  const [folderEditor, setFolderEditor] = useState<FolderEditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    account: AccountSummary;
    folder: MailFolderSummary;
  } | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [draggedFolder, setDraggedFolder] = useState<{
    accountId: string;
    folderPath: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<FolderDropTarget | null>(null);
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);
  const [accountDropTarget, setAccountDropTarget] = useState<{
    accountId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [accountReorderError, setAccountReorderError] = useState<string | null>(null);
  const displayedFolderStates: Record<string, FolderLoadState> =
    demoMode && demoFolderMap
      ? Object.fromEntries(
          accounts.map((account) => [
            account.id,
            { status: 'loaded' as const, folders: demoFolderMap[account.id] ?? [] },
          ]),
        )
      : folderStates;
  const unifiedInboxUnread = accounts.reduce((total, account) => {
    const folderState = displayedFolderStates[account.id];
    return total + (folderState?.status === 'loaded' ? inboxUnreadCount(folderState.folders) : 0);
  }, 0);

  const dropAccount = async (targetId: string, position: 'before' | 'after') => {
    if (!draggedAccountId || draggedAccountId === targetId) return;
    const nextIds = accounts.map((account) => account.id);
    const sourceIndex = nextIds.indexOf(draggedAccountId);
    if (sourceIndex < 0) return;
    nextIds.splice(sourceIndex, 1);
    const targetIndex = nextIds.indexOf(targetId);
    nextIds.splice(targetIndex + (position === 'after' ? 1 : 0), 0, draggedAccountId);
    setAccountReorderError(null);
    if (!(await onReorder(nextIds))) setAccountReorderError('Could not save the account order.');
    setDraggedAccountId(null);
    setAccountDropTarget(null);
  };

  const applyFolderResult = (accountId: string, result: FolderMutationResult): boolean => {
    if (!result.ok) {
      setFolderError(result.message ?? 'The folder could not be updated.');
      return false;
    }
    setFolderStates((current) => ({
      ...current,
      [accountId]: { status: 'loaded', folders: result.folders },
    }));
    setFolderError(null);
    return true;
  };

  const submitFolderEditor = async (name: string, parentPath: string) => {
    if (!folderEditor || folderBusy) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      const result = folderEditor.kind === 'create'
        ? await window.emzero.folders.create(folderEditor.account.id, { name, parentPath })
        : await window.emzero.folders.rename(folderEditor.account.id, {
            folderPath: folderEditor.folder.path,
            name,
          });
      if (!applyFolderResult(folderEditor.account.id, result)) return;
      if (folderEditor.kind === 'rename' && selection.kind === 'folder') {
        const { folder } = folderEditor;
        if (
          selection.account.id === folderEditor.account.id &&
          (selection.folder.path === folder.path ||
            selection.folder.path.startsWith(`${folder.path}${folder.delimiter}`))
        ) {
          const nextPath = joinedFolderPath(folder.parentPath, name.trim(), folder.delimiter);
          const selectedPath = selection.folder.path.replace(folder.path, nextPath);
          const selectedFolder = result.folders.find((candidate) => candidate.path === selectedPath);
          if (selectedFolder) onSelect({ kind: 'folder', account: folderEditor.account, folder: selectedFolder });
        }
      }
      setFolderEditor(null);
    } catch {
      setFolderError('The folder could not be updated.');
    } finally {
      setFolderBusy(false);
    }
  };

  const deleteFolder = async () => {
    if (!deleteTarget || folderBusy) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      const result = await window.emzero.folders.delete(
        deleteTarget.account.id,
        deleteTarget.folder.path,
      );
      if (!applyFolderResult(deleteTarget.account.id, result)) return;
      if (
        selection.kind === 'folder' &&
        selection.account.id === deleteTarget.account.id &&
        (selection.folder.path === deleteTarget.folder.path ||
          selection.folder.path.startsWith(
            `${deleteTarget.folder.path}${deleteTarget.folder.delimiter}`,
          ))
      ) {
        const inbox = findInboxFolder(result.folders);
        onSelect(inbox
          ? { kind: 'folder', account: deleteTarget.account, folder: inbox }
          : { kind: 'unified' });
      }
      setDeleteTarget(null);
    } catch {
      setFolderError('The folder could not be deleted.');
    } finally {
      setFolderBusy(false);
    }
  };

  const moveDraggedFolder = async (
    account: AccountSummary,
    target: FolderDropTarget,
  ) => {
    if (!draggedFolder || draggedFolder.accountId !== account.id || folderBusy) return;
    const folderState = displayedFolderStates[account.id];
    if (folderState?.status !== 'loaded') return;
    const source = folderState.folders.find((folder) => folder.path === draggedFolder.folderPath);
    if (!source) return;
    const request = folderMoveRequestForDrop(
      folderState.folders,
      source.path,
      target.folderPath,
      target.mode,
    );
    if (!request) return;
    const previousFolders = folderState.folders;
    const optimisticFolders = optimisticFolderMove(previousFolders, request);
    if (!optimisticFolders) return;
    const nextPath = joinedFolderPath(request.parentPath, source.name, source.delimiter);
    const selectedPath =
      selection.kind === 'folder' &&
      selection.account.id === account.id &&
      (selection.folder.path === source.path ||
        selection.folder.path.startsWith(`${source.path}${source.delimiter}`))
        ? selection.folder.path.replace(source.path, nextPath)
        : null;
    setFolderStates((current) => ({
      ...current,
      [account.id]: { status: 'loaded', folders: optimisticFolders },
    }));
    if (selectedPath) {
      const selectedFolder = optimisticFolders.find((folder) => folder.path === selectedPath);
      if (selectedFolder) onSelect({ kind: 'folder', account, folder: selectedFolder });
    }
    setFolderBusy(true);
    setFolderError(null);
    try {
      const result = await window.emzero.folders.move(account.id, request);
      if (!result.ok) {
        setFolderStates((current) => ({
          ...current,
          [account.id]: { status: 'loaded', folders: previousFolders },
        }));
        setFolderError(result.message ?? 'The folder could not be moved.');
        if (selectedPath && selection.kind === 'folder') onSelect(selection);
        return;
      }
      applyFolderResult(account.id, result);
      if (selectedPath) {
        const selectedFolder = result.folders.find((folder) => folder.path === selectedPath);
        if (selectedFolder) onSelect({ kind: 'folder', account, folder: selectedFolder });
      }
    } catch {
      setFolderStates((current) => ({
        ...current,
        [account.id]: { status: 'loaded', folders: previousFolders },
      }));
      setFolderError('The folder could not be moved.');
      if (selectedPath && selection.kind === 'folder') onSelect(selection);
    } finally {
      setFolderBusy(false);
      setDraggedFolder(null);
      setDropTarget(null);
    }
  };

  const loadFolders = useCallback(
    (accountId: string, onLoaded?: (folders: MailFolderSummary[]) => void) => {
      const localFolders = demoFolderMap?.[accountId];
      if (demoMode && localFolders) {
        setFolderStates((current) => ({
          ...current,
          [accountId]: { status: 'loaded', folders: localFolders },
        }));
        onLoaded?.(localFolders);
        return;
      }
      setFolderStates((current) => ({ ...current, [accountId]: { status: 'loading' } }));
      void window.emzero.folders
        .list(accountId)
        .then((result) => {
          setFolderStates((current) => ({
            ...current,
            [accountId]: result.ok
              ? { status: 'loaded', folders: result.folders }
              : { status: 'error', message: result.message ?? 'Could not load folders.' },
          }));
          if (result.ok) onLoaded?.(result.folders);
        })
        .catch(() => {
          setFolderStates((current) => ({
            ...current,
            [accountId]: { status: 'error', message: 'Could not load folders.' },
          }));
        });
    },
    [demoFolderMap, demoMode],
  );

  useEffect(() => {
    if (demoMode) return;
    let active = true;
    void Promise.allSettled(accounts.map((account) => window.emzero.folders.list(account.id))).then(
      (results) => {
        if (!active) return;
        setFolderStates((current) => {
          const next = { ...current };
          results.forEach((result, index) => {
            const accountId = accounts[index].id;
            next[accountId] =
              result.status === 'fulfilled' && result.value.ok
                ? { status: 'loaded', folders: result.value.folders }
                : {
                    status: 'error',
                    message:
                      result.status === 'fulfilled'
                        ? (result.value.message ?? 'Could not load folders.')
                        : 'Could not load folders.',
                  };
          });
          return next;
        });
      },
    );
    return () => {
      active = false;
    };
  }, [accounts, demoFolderMap, demoMode, syncRevision]);

  useEffect(
    () => {
      if (demoMode) return;
      return window.emzero.messages.onBulkJobProgress((progress) => {
        if (!progress.accountId || !progress.folder) return;
        setFolderStates((current) => {
          const accountState = current[progress.accountId!];
          if (accountState?.status !== 'loaded') return current;
          return {
            ...current,
            [progress.accountId!]: {
              status: 'loaded',
              folders: accountState.folders.map((folder) =>
                folder.path === progress.folder!.path ? progress.folder! : folder,
              ),
            },
          };
        });
      });
    },
    [demoMode],
  );

  const toggleAccount = (account: AccountSummary) => {
    const isOpening = !expanded.has(account.id);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(account.id)) next.delete(account.id);
      else next.add(account.id);
      return next;
    });
    if (isOpening) {
      const selectInbox = (folders: MailFolderSummary[]) => {
        const inbox = findInboxFolder(folders);
        if (inbox) onSelect({ kind: 'folder', account, folder: inbox });
      };
      const folderState = displayedFolderStates[account.id];
      if (folderState?.status === 'loaded') selectInbox(folderState.folders);
      else loadFolders(account.id, selectInbox);
    }
  };
  const editorFolderState = folderEditor ? displayedFolderStates[folderEditor.account.id] : undefined;

  const logoStyle = {
    '--emzero-logo-mask': `url("${emzeroLogoUrl}")`,
  } as CSSProperties;

  return (
    <>
      <aside
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden border-r border-border bg-sidebar p-4',
        className,
      )}
    >
      {window.emzero?.platform === 'darwin' && (
        <div className="macos-titlebar-drag absolute inset-x-0 top-0 h-6 shrink-0" />
      )}
      <div className="mb-8 flex shrink-0 items-center gap-3 px-2">
        <button
          type="button"
          className="emzero-logo size-9 shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={logoStyle}
          aria-label="Emzero"
          onClick={() => {
            const now = Date.now();
            const recentClicks = demoClickTimes.current.filter(
              (clickedAt) => now - clickedAt < 2_000,
            );
            recentClicks.push(now);
            demoClickTimes.current = recentClicks;
            if (recentClicks.length >= 5) {
              demoClickTimes.current = [];
              onDemoModeChange(!demoMode);
            }
          }}
        >
          <img
            src={emzeroLogoUrl}
            alt=""
            width={192}
            height={192}
            draggable={false}
            className="size-full object-contain"
          />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold tracking-tight">Emzero</p>
          <p className="text-xs text-muted-foreground">Mail</p>
        </div>
        {onPinnedChange && pinned !== undefined && (
          <Button
            variant="ghost"
            className="size-8 shrink-0 px-0"
            aria-label={pinned ? 'Unpin navigation' : 'Pin navigation'}
            title={pinned ? 'Unpin navigation' : 'Keep navigation open'}
            onClick={() => onPinnedChange(!pinned)}
          >
            {pinned
              ? <PanelLeftClose className="size-4" />
              : <PanelLeftOpen className="size-4" />}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <Button
          className="mb-4 w-full justify-start"
          disabled={accounts.length === 0}
          onClick={onCompose}
        >
          <PenLine className="size-4" />
          Compose
        </Button>

        <Button
          variant={selection.kind === 'search' ? 'secondary' : 'ghost'}
          className="mb-2 w-full justify-start"
          onClick={() => onSelect({ kind: 'search', query: '' })}
        >
          <Search className="size-4" />
          Search mail
          <kbd className="ml-auto text-[0.62rem] font-normal text-muted-foreground">
            {window.emzero?.platform === 'darwin' ? '⌘K' : 'Ctrl K'}
          </kbd>
        </Button>

        <nav aria-label="Mailboxes" className="space-y-1">
        <Button
          variant={selection.kind === 'unified' && (selection.mailbox ?? 'inbox') === 'inbox' ? 'secondary' : 'ghost'}
          className="w-full shrink-0 justify-start"
          onClick={() => onSelect({ kind: 'unified', mailbox: 'inbox' })}
        >
          <Inbox className="size-4" />
          Inbox
          <UnreadBadge count={unifiedInboxUnread} />
        </Button>
        <Button
          variant={selection.kind === 'unified' && selection.mailbox === 'starred' ? 'secondary' : 'ghost'}
          className="w-full shrink-0 justify-start"
          onClick={() => onSelect({ kind: 'unified', mailbox: 'starred' })}
        >
          <Star className="size-4" />
          Starred
        </Button>
        <Button
          variant={selection.kind === 'unified' && selection.mailbox === 'drafts' ? 'secondary' : 'ghost'}
          className="w-full shrink-0 justify-start"
          onClick={() => onSelect({ kind: 'unified', mailbox: 'drafts' })}
        >
          <FileText className="size-4" />
          Drafts
        </Button>
        <Button
          variant={selection.kind === 'unified' && selection.mailbox === 'trash' ? 'secondary' : 'ghost'}
          className="w-full shrink-0 justify-start"
          onClick={() => onSelect({ kind: 'unified', mailbox: 'trash' })}
        >
          <Trash2 className="size-4" />
          Trash
        </Button>
        {accounts.length > 0 && (
          <div className="pt-5">
            <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Accounts
            </p>
            {accounts.map((account) => {
              const isExpanded = expanded.has(account.id);
              const folderState = displayedFolderStates[account.id];
              const collapsedPaths = collapsedFolders[account.id] ?? new Set<string>();
              const accountUnread =
                folderState?.status === 'loaded'
                  ? accountUnreadCount(folderState.folders)
                  : 0;
              return (
                <div
                  key={account.id}
                  className={cn(
                    'relative',
                    accountDropTarget?.accountId === account.id && accountDropTarget.position === 'before' &&
                      'before:absolute before:inset-x-1 before:top-0 before:z-10 before:h-0.5 before:bg-primary',
                    accountDropTarget?.accountId === account.id && accountDropTarget.position === 'after' &&
                      'after:absolute after:inset-x-1 after:bottom-0 after:z-10 after:h-0.5 after:bg-primary',
                    draggedAccountId === account.id && 'opacity-50',
                  )}
                >
                  <div
                    onDragOver={(event) => {
                      if (!draggedAccountId || draggedAccountId === account.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setAccountDropTarget({
                        accountId: account.id,
                        position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                      });
                    }}
                    onDrop={(event) => {
                      if (!accountDropTarget) return;
                      event.preventDefault();
                      void dropAccount(account.id, accountDropTarget.position);
                    }}
                  >
                    <Button
                      variant="ghost"
                      className="h-auto w-full cursor-grab justify-start gap-2 py-2 focus-visible:ring-inset active:cursor-grabbing"
                      aria-expanded={isExpanded}
                      draggable={!demoMode}
                      title={demoMode ? 'Sample account' : 'Drag to reorder account'}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', account.id);
                        setDraggedAccountId(account.id);
                      }}
                      onDragEnd={() => {
                        setDraggedAccountId(null);
                        setAccountDropTarget(null);
                      }}
                      onClick={() => toggleAccount(account)}
                    >
                    {isExpanded ? (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-account text-xs font-semibold text-primary">
                      {account.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm">{account.name}</span>
                      <span className="block truncate text-[0.68rem] font-normal text-muted-foreground">
                        {account.email}
                      </span>
                    </span>
                    {!isExpanded && <UnreadBadge count={accountUnread} />}
                    </Button>
                  </div>

                  {isExpanded && (
                    <div className="mb-2 ml-5 border-l border-border pl-2">
                      {(!folderState || folderState.status === 'loading') && (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                          <LoaderCircle className="size-3.5 animate-spin" />
                          Loading folders
                        </div>
                      )}
                      {folderState?.status === 'error' && (
                        <button
                          type="button"
                          className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-xs text-danger hover:bg-accent"
                          title={folderState.message}
                          onClick={() => loadFolders(account.id)}
                        >
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span>Could not load folders. Click to retry.</span>
                        </button>
                      )}
                      {folderState?.status === 'loaded' &&
                        visibleFolderTree(folderState.folders, collapsedPaths).map((folder) => {
                          const depth = folder.parentPath
                            ? folder.parentPath.split(folder.delimiter).length
                            : 0;
                          const hasChildren = folderState.folders.some(
                            (candidate) => candidate.parentPath === folder.path,
                          );
                          const isCollapsed = collapsedPaths.has(folder.path);
                          const canManage = !demoMode && manageableFolder(folder);
                          const isSelected =
                            selection.kind === 'folder' &&
                            selection.account.id === account.id &&
                            selection.folder.path === folder.path;
                          return (
                            <div
                              key={folder.path}
                              className={cn(
                                'group/folder relative flex rounded-md',
                                dropTarget?.accountId === account.id &&
                                  dropTarget.folderPath === folder.path &&
                                  dropTarget.mode === 'inside' && 'bg-primary/12 ring-1 ring-inset ring-primary/50',
                                dropTarget?.accountId === account.id &&
                                  dropTarget.folderPath === folder.path &&
                                  dropTarget.mode === 'before' && 'before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:bg-primary',
                                dropTarget?.accountId === account.id &&
                                  dropTarget.folderPath === folder.path &&
                                  dropTarget.mode === 'after' && 'after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary',
                                draggedFolder?.accountId === account.id &&
                                  draggedFolder.folderPath === folder.path && 'opacity-45',
                              )}
                              draggable={canManage && !folderBusy}
                              onDragStart={(event) => {
                                if (!canManage) return;
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', folder.path);
                                setDraggedFolder({ accountId: account.id, folderPath: folder.path });
                              }}
                              onDragEnd={() => {
                                setDraggedFolder(null);
                                setDropTarget(null);
                              }}
                              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                                if (!draggedFolder || draggedFolder.accountId !== account.id) return;
                                const source = folderState.folders.find(
                                  (candidate) => candidate.path === draggedFolder.folderPath,
                                );
                                if (
                                  !source ||
                                  folder.path === source.path ||
                                  folder.path.startsWith(`${source.path}${source.delimiter}`)
                                ) return;
                                event.preventDefault();
                                const bounds = event.currentTarget.getBoundingClientRect();
                                const ratio = (event.clientY - bounds.top) / bounds.height;
                                const mode = ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside';
                                event.dataTransfer.dropEffect = 'move';
                                setDropTarget({ accountId: account.id, folderPath: folder.path, mode });
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                if (dropTarget) void moveDraggedFolder(account, dropTarget);
                              }}
                            >
                              <button
                                type="button"
                                className="grid size-5 shrink-0 place-items-center self-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none"
                                style={{ marginLeft: `${depth * 0.75}rem` }}
                                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
                                aria-expanded={hasChildren ? !isCollapsed : undefined}
                                disabled={!hasChildren}
                                onClick={() => {
                                  if (!hasChildren) return;
                                  setCollapsedFolders((current) => {
                                    const next = new Set(current[account.id] ?? []);
                                    if (next.has(folder.path)) next.delete(folder.path);
                                    else next.add(folder.path);
                                    return { ...current, [account.id]: next };
                                  });
                                }}
                              >
                                {hasChildren && (isCollapsed
                                  ? <ChevronRight className="size-3.5" />
                                  : <ChevronDown className="size-3.5" />)}
                              </button>
                              <Button
                                variant={isSelected ? 'secondary' : 'ghost'}
                                className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-2 font-normal"
                                disabled={!folder.selectable}
                                title={canManage ? `${folder.path} · drag to move` : folder.path}
                                onClick={() => onSelect({ kind: 'folder', account, folder })}
                              >
                                <span className="grid size-3 shrink-0 place-items-center">
                                  {canManage && (
                                    <GripVertical className="size-3 cursor-grab text-muted-foreground opacity-0 group-hover/folder:opacity-100" />
                                  )}
                                </span>
                                <FolderIcon specialUse={folder.specialUse} />
                                <span className="min-w-0 flex-1 truncate text-left text-xs leading-4">
                                  {displayFolderName(folder)}
                                </span>
                                <UnreadBadge count={folder.unreadCount ?? 0} />
                              </Button>
                              {canManage && (
                                <div className="absolute right-1 top-0.5 flex bg-sidebar opacity-0 group-hover/folder:opacity-100 focus-within:opacity-100">
                                  <Button
                                    variant="ghost"
                                    className="size-6 px-0"
                                    aria-label={`Rename ${folder.name}`}
                                    title="Rename folder"
                                    disabled={folderBusy}
                                    onClick={() => {
                                      setFolderError(null);
                                      setFolderEditor({ kind: 'rename', account, folder });
                                    }}
                                  >
                                    <PenLine className="size-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    className="size-6 px-0 text-danger hover:text-danger"
                                    aria-label={`Delete ${folder.name}`}
                                    title="Delete folder"
                                    disabled={folderBusy}
                                    onClick={() => {
                                      setFolderError(null);
                                      setDeleteTarget({ account, folder });
                                    }}
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      {folderState?.status === 'loaded' && draggedFolder?.accountId === account.id && (
                        <div
                          className={cn(
                            'mx-1 mt-1 rounded-md border border-dashed px-2 py-1.5 text-center text-[0.68rem] text-muted-foreground',
                            dropTarget?.accountId === account.id && dropTarget.mode === 'root' &&
                              'border-primary bg-primary/10 text-foreground',
                          )}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDropTarget({ accountId: account.id, folderPath: null, mode: 'root' });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            void moveDraggedFolder(account, {
                              accountId: account.id,
                              folderPath: null,
                              mode: 'root',
                            });
                          }}
                        >
                          Move to top level
                        </div>
                      )}
                      {folderState?.status === 'loaded' && (
                        <Button
                          variant="ghost"
                          className="mt-1 h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                          disabled={folderBusy}
                          onClick={() => {
                            setFolderError(null);
                            setFolderEditor({ kind: 'create', account, parentPath: '' });
                          }}
                        >
                          <Plus className="size-3.5" />
                          New folder
                        </Button>
                      )}
                      {folderError && isExpanded && (
                        <p className="px-2 py-1.5 text-xs text-danger">{folderError}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {accountReorderError && (
              <p className="px-3 pt-2 text-xs text-danger">{accountReorderError}</p>
            )}
          </div>
        )}
        </nav>
      </div>

      <div className="mt-auto shrink-0 border-t border-border pt-4">
        <Button
          variant="ghost"
          className="mb-1 w-full justify-start text-muted-foreground"
          disabled={syncStatus.state === 'syncing' || accounts.length === 0}
          aria-disabled={demoMode}
          title={demoMode ? 'Unavailable in demo mode' : syncStatus.message}
          onClick={() => {
            if (!demoMode) void window.emzero.sync.now();
          }}
        >
          <RefreshCw
            className={`size-4 ${syncStatus.state === 'syncing' ? 'animate-spin' : ''}`}
          />
          {syncStatus.state === 'syncing'
            ? 'Syncing mail'
            : syncStatus.state === 'error'
              ? 'Sync needs attention'
              : syncStatus.lastSyncedAt
                ? `Synced ${messageDate(syncStatus.lastSyncedAt)}`
                : 'Sync mail'}
        </Button>
        <Button
          variant="ghost"
          className="mb-1 w-full justify-start text-muted-foreground"
          aria-disabled={demoMode}
          title={demoMode ? 'Unavailable in demo mode' : undefined}
          onClick={() => {
            if (!demoMode) onManage();
          }}
        >
          <Settings2 className="size-4" />
          Settings
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
          aria-disabled={demoMode}
          title={demoMode ? 'Unavailable in demo mode' : undefined}
          onClick={() => {
            if (!demoMode) onAdd();
          }}
        >
          <Plus className="size-4" />
          Add account
        </Button>
      </div>
      </aside>
      {folderEditor && (
        <FolderEditorDialog
          key={folderEditor.kind === 'create'
            ? `create:${folderEditor.account.id}:${folderEditor.parentPath}`
            : `rename:${folderEditor.account.id}:${folderEditor.folder.path}`}
          state={folderEditor}
          folders={editorFolderState?.status === 'loaded'
            ? editorFolderState.folders
            : []}
          busy={folderBusy}
          error={folderError}
          onClose={() => {
            setFolderEditor(null);
            setFolderError(null);
          }}
          onSubmit={(name, parentPath) => void submitFolderEditor(name, parentPath)}
        />
      )}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !folderBusy) {
            setDeleteTarget(null);
            setFolderError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.folder.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The folder and any messages it contains will be deleted from the mail server. This
              cannot be undone in Emzero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {folderError && <p className="text-sm text-danger">{folderError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={folderBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={folderBusy}
              onClick={(event) => {
                event.preventDefault();
                void deleteFolder();
              }}
            >
              {folderBusy && <LoaderCircle className="size-4 animate-spin" />}
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
