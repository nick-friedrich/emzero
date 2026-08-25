import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  Check,
  FileText,
  Folder,
  Inbox,
  LoaderCircle,
  Mail,
  MailOpen,
  Send,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  cn,
} from '@/lib/utils';
import {
  messageThemeColors,
  themeColorSchemes,
  type Theme,
} from '@/theme';
import {
  type AccountSummary,
  type BulkMessageJobRequest,
  type BulkMessageJobStartResult,
  type MailFolderSummary,
  type MailMessageDetail,
  type MailMessageSummary,
  type MessageMoveDestination,
  findArchiveFolder,
} from '../../shared/accounts';
import type { MailConversation } from '../../shared/conversations';
import { MoveToDialog } from './message-move';

export type MailboxSelection =
  | { kind: 'unified' }
  | { kind: 'search'; query: string }
  | { kind: 'folder'; account: AccountSummary; folder: MailFolderSummary };

export type FolderSelection = Extract<MailboxSelection, { kind: 'folder' }>;

export type FolderLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; folders: MailFolderSummary[] }
  | { status: 'error'; message: string };

export function FolderIcon({ specialUse }: { specialUse: string | null }) {
  switch (specialUse) {
    case '\\Inbox':
      return <Inbox className="size-3" />;
    case '\\Sent':
      return <Send className="size-3" />;
    case '\\Drafts':
      return <FileText className="size-3" />;
    case '\\Archive':
      return <Archive className="size-3" />;
    case '\\Trash':
    case '\\Junk':
      return <Trash2 className="size-3" />;
    default:
      return <Folder className="size-3" />;
  }
}

export function joinedFolderPath(parentPath: string, name: string, delimiter: string): string {
  return parentPath ? `${parentPath}${delimiter}${name}` : name;
}

export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto min-w-5 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.62rem] font-semibold tabular-nums leading-none text-primary-foreground"
      aria-label={`${count} unread ${count === 1 ? 'message' : 'messages'}`}
    >
      {count > 999 ? '999+' : count}
    </span>
  );
}

export function addressLabel(addresses: MailMessageSummary['from']): string {
  if (addresses.length === 0) return 'Unknown sender';
  return [...new Map(addresses.map((address) => [address.address ?? address.name, address])).values()]
    .map(({ name, address }) => name || address || 'Unknown sender')
    .join(', ');
}

export function addressDetails(addresses: MailMessageSummary['from']): string {
  if (addresses.length === 0) return 'Unknown';
  return addresses
    .map(({ name, address }) => {
      if (name && address) return `${name} <${address}>`;
      return name || address || 'Unknown';
    })
    .join(', ');
}

export function conversationOpponent(
  messages: MailMessageSummary[],
  account: AccountSummary,
): string {
  const ownAddresses = new Set(
    [account.email, account.username, account.name]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const opponents = messages
    .flatMap((message) => [...message.from, ...message.to])
    .filter(({ name, address }) => {
      const identity = (address || name)?.trim().toLowerCase();
      return identity ? !ownAddresses.has(identity) : false;
    });

  if (opponents.length > 0) return addressLabel(opponents);

  const fallback = messages.flatMap((message) =>
    message.from.length > 0 ? message.from : message.to,
  );
  return addressLabel(fallback);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function htmlDocument(body: string, showQuoted: boolean, theme: Theme): string {
  const quotedStyle = showQuoted
    ? ''
    : 'blockquote,.gmail_quote,.yahoo_quoted,.moz-cite-prefix,#divRplyFwdMsg{display:none!important}';
  const colors = messageThemeColors[theme];
  const colorScheme = themeColorSchemes[theme];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${colorScheme}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>html{color-scheme:${colorScheme};background:${colors.background};scrollbar-color:color-mix(in oklab,${colors.primary} 55%,transparent) transparent;scrollbar-width:thin}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{min-width:40px;min-height:40px;border:3px solid transparent;border-radius:999px;background:color-mix(in oklab,${colors.primary} 55%,transparent);background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:color-mix(in oklab,${colors.primary} 78%,transparent);background-clip:content-box}body{box-sizing:border-box;margin:0;padding:1.5rem;color:${colors.foreground};background:${colors.background};font:14px/1.65 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}a{color:inherit}img{max-width:100%;height:auto}table{max-width:100%}${quotedStyle}</style></head><body>${body}</body></html>`;
}

export function messageDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export type MessageLoadState =
  | { status: 'loading' }
  | {
      status: 'loaded';
      messages: MailMessageSummary[];
      relatedMessages: MailMessageSummary[];
      total: number;
      notice?: string;
    }
  | { status: 'error'; message: string };

export interface UnifiedConversationItem {
  selection: FolderSelection;
  folders: MailFolderSummary[];
  conversation: MailConversation;
}

interface UnifiedAccountFailure {
  account: AccountSummary;
  message: string;
}

export type UnifiedInboxLoadState =
  | { status: 'loading' }
  | {
      status: 'loaded';
      items: UnifiedConversationItem[];
      failures: UnifiedAccountFailure[];
      notices: UnifiedAccountFailure[];
      loadedMessages: number;
      totalMessages: number;
    };

export type MessageDetailLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; message: MailMessageDetail }
  | { status: 'error'; message: string };

export type ConversationAction = 'read' | 'unread' | 'star' | 'unstar' | 'move' | 'delete';

export type StartBulkOperation = (
  request: BulkMessageJobRequest,
  location: string,
) => Promise<BulkMessageJobStartResult>;

const bulkActionConfirmationThreshold = 10;

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return (
    target instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'reset', 'submit'].includes(target.type)
  );
}

export function messageCountInFolder(conversation: MailConversation, folderPath: string): number {
  return conversation.messages.filter((message) => message.folderPath === folderPath).length;
}

export async function performConversationAction(
  accountId: string,
  folderPath: string,
  conversation: MailConversation,
  action: ConversationAction,
  destination?: MessageMoveDestination,
): Promise<string | null> {
  if (action === 'move' && !destination) return 'Choose a destination folder.';
  const uids = conversation.messages
    .filter((message) => message.folderPath === folderPath)
    .map((message) => message.uid);
  const result =
    action === 'delete'
      ? await window.emzero.messages.delete(accountId, folderPath, uids)
      : action === 'move' && destination
        ? await window.emzero.messages.move(
            accountId,
            folderPath,
            uids,
            destination.accountId,
            destination.folderPath,
          )
        : action === 'star' || action === 'unstar'
          ? await window.emzero.messages.setFlagged(accountId, folderPath, uids, action === 'star')
          : await window.emzero.messages.setUnread(accountId, folderPath, uids, action === 'unread');
  return result.ok ? null : result.message ?? 'The action could not be completed.';
}

export function conversationWithUnreadValues(
  conversation: MailConversation,
  unreadByMessage: ReadonlyMap<string, boolean>,
): MailConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => {
      const unread = unreadByMessage.get(`${message.folderPath}:${message.uid}`);
      return unread === undefined ? message : { ...message, unread };
    }),
  };
}

export function conversationWithFlaggedValues(
  conversation: MailConversation,
  flaggedByMessage: ReadonlyMap<string, boolean>,
): MailConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => {
      const flagged = flaggedByMessage.get(`${message.folderPath}:${message.uid}`);
      return flagged === undefined ? message : { ...message, flagged };
    }),
  };
}

export function conversationWithMessage(
  conversation: MailConversation,
  message: MailMessageSummary,
): MailConversation {
  const key = `${message.folderPath}:${message.uid}`;
  return {
    ...conversation,
    messages: [
      message,
      ...conversation.messages.filter(
        (candidate) => `${candidate.folderPath}:${candidate.uid}` !== key,
      ),
    ],
  };
}

export function ConversationActions({
  accounts,
  sourceAccountId,
  folders,
  sourcePath,
  messageCount,
  unread,
  flagged,
  busy,
  confirmPermanentDelete,
  onSetUnread,
  onSetFlagged,
  onMove,
  onDelete,
}: {
  accounts: AccountSummary[];
  sourceAccountId: string;
  folders: MailFolderSummary[];
  sourcePath: string;
  messageCount: number;
  unread: boolean;
  flagged: boolean;
  busy: boolean;
  confirmPermanentDelete: boolean;
  onSetUnread: (unread: boolean) => void;
  onSetFlagged: (flagged: boolean) => void;
  onMove: (destination: MessageMoveDestination) => void;
  onDelete: () => void;
}) {
  const archive = findArchiveFolder(folders);
  const unreadLabel = unread ? 'Mark as read' : 'Mark as unread';
  const deleteButton = (
    <Button
      variant="ghost"
      className="size-8 px-0 text-danger hover:text-danger"
      aria-label="Delete conversation"
      title="Delete conversation"
      disabled={busy}
      onClick={confirmPermanentDelete ? undefined : onDelete}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </Button>
  );
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label="Conversation actions">
      <Button
        variant="ghost"
        className="size-8 px-0"
        aria-label={unreadLabel}
        title={unreadLabel}
        disabled={busy}
        onClick={() => onSetUnread(!unread)}
      >
        {unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
      </Button>
      <Button
        variant="ghost"
        className="size-8 px-0"
        aria-label={flagged ? 'Remove star' : 'Add star'}
        title={flagged ? 'Remove star' : 'Add star'}
        disabled={busy}
        onClick={() => onSetFlagged(!flagged)}
      >
        <Star className={cn('size-4', flagged && 'fill-primary text-primary')} />
      </Button>
      {archive && archive.path !== sourcePath && (
        <Button
          variant="ghost"
          className="size-8 px-0"
          aria-label="Archive conversation"
          title="Archive conversation"
          disabled={busy}
          onClick={() => onMove({ accountId: sourceAccountId, folderPath: archive.path })}
        >
          <Archive className="size-4" />
        </Button>
      )}
      <MoveToDialog
        accounts={accounts}
        sourceAccountId={sourceAccountId}
        sourceFolders={folders}
        sourcePath={sourcePath}
        count={messageCount}
        busy={busy}
        compact
        onMove={onMove}
      />
      {confirmPermanentDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>{deleteButton}</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently delete this conversation?</AlertDialogTitle>
              <AlertDialogDescription>
                This conversation will be permanently removed and cannot be recovered.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Permanently delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        deleteButton
      )}
    </div>
  );
}

export function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  className,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  className?: string;
  onChange: (shiftKey: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cn('relative grid size-5 shrink-0 cursor-pointer place-items-center', className)}>
      <input
        ref={ref}
        className="peer sr-only"
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange((event.nativeEvent as MouseEvent).shiftKey)}
      />
      <span
        className={cn(
          'grid size-4 place-items-center rounded-[0.3rem] border bg-card text-primary-foreground shadow-sm transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
          checked || indeterminate
            ? 'border-primary bg-primary'
            : 'border-border hover:border-primary/70',
        )}
        aria-hidden="true"
      >
        {indeterminate ? (
          <span className="h-0.5 w-2 rounded-full bg-current" />
        ) : checked ? (
          <Check className="size-3" strokeWidth={3} />
        ) : null}
      </span>
    </label>
  );
}

export function BulkActionToolbar({
  accounts,
  sourceAccountId,
  sourceLocations,
  folders,
  sourcePath,
  canArchive: canArchiveOverride,
  selectedRows,
  selectedEmails,
  totalRows,
  busy,
  permanentDelete,
  onToggleAll,
  onClear,
  onAction,
  onMove,
}: {
  accounts: AccountSummary[];
  sourceAccountId: string;
  sourceLocations?: MessageMoveDestination[];
  folders: MailFolderSummary[];
  sourcePath: string;
  canArchive?: boolean;
  selectedRows: number;
  selectedEmails: number;
  totalRows: number;
  busy: boolean;
  permanentDelete: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  onAction: (action: BulkMessageJobRequest['action']) => void;
  onMove: (destination: MessageMoveDestination) => void;
}) {
  const [pendingAction, setPendingAction] = useState<BulkMessageJobRequest['action'] | null>(null);
  const allSelected = selectedRows === totalRows;
  const archive = findArchiveFolder(folders);
  const canArchive = canArchiveOverride ?? Boolean(archive && archive.path !== sourcePath);
  const needsConfirmation = (action: BulkMessageJobRequest['action']) =>
    selectedEmails > bulkActionConfirmationThreshold || (action === 'delete' && permanentDelete);
  const requestAction = (action: BulkMessageJobRequest['action']) => {
    if (needsConfirmation(action)) setPendingAction(action);
    else onAction(action);
  };
  const actionLabel =
    pendingAction === 'read'
      ? 'mark as read'
      : pendingAction === 'unread'
        ? 'mark as unread'
        : pendingAction === 'star'
          ? 'add a star to'
          : pendingAction === 'unstar'
            ? 'remove the star from'
        : pendingAction === 'archive'
          ? 'archive'
        : 'delete';

  return (
    <>
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border bg-secondary px-4 py-2 lg:px-6" role="toolbar" aria-label="Bulk email actions">
        <SelectionCheckbox
          checked={allSelected}
          indeterminate={!allSelected}
          label={allSelected ? 'Clear selection' : 'Select all conversations'}
          onChange={onToggleAll}
        />
        <span className="mr-auto text-sm font-medium">
          {selectedEmails} {selectedEmails === 1 ? 'email' : 'emails'} selected
        </span>
        <Button variant="ghost" className="px-3" disabled={busy} onClick={() => requestAction('read')}>
          <MailOpen className="size-4" />
          <span className="hidden sm:inline">Mark read</span>
        </Button>
        <Button variant="ghost" className="px-3" disabled={busy} onClick={() => requestAction('unread')}>
          <Mail className="size-4" />
          <span className="hidden sm:inline">Mark unread</span>
        </Button>
        <Button variant="ghost" className="px-3" disabled={busy} onClick={() => requestAction('star')}>
          <Star className="size-4" />
          <span className="hidden sm:inline">Star</span>
        </Button>
        <Button variant="ghost" className="px-3" disabled={busy} onClick={() => requestAction('unstar')}>
          <Star className="size-4" />
          <span className="hidden sm:inline">Unstar</span>
        </Button>
        {canArchive && (
          <Button variant="ghost" className="px-3" disabled={busy} onClick={() => requestAction('archive')}>
            <Archive className="size-4" />
            <span className="hidden sm:inline">Archive</span>
          </Button>
        )}
        <MoveToDialog
          accounts={accounts}
          sourceAccountId={sourceAccountId}
          sourceFolders={folders}
          sourcePath={sourcePath}
          sourceLocations={sourceLocations}
          count={selectedEmails}
          busy={busy}
          onMove={onMove}
        />
        <Button variant="ghost" className="px-3 text-danger hover:text-danger" disabled={busy} onClick={() => requestAction('delete')}>
          <Trash2 className="size-4" />
          <span className="hidden sm:inline">Delete</span>
        </Button>
        <Button variant="ghost" className="px-3" disabled={busy} onClick={onClear}>Cancel</Button>
      </div>
      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === 'delete' && permanentDelete
                ? `Permanently delete ${selectedEmails} emails?`
                : `${pendingAction === 'delete' ? 'Delete' : pendingAction === 'read' ? 'Mark as read' : pendingAction === 'unread' ? 'Mark as unread' : pendingAction === 'star' ? 'Star' : pendingAction === 'unstar' ? 'Unstar' : 'Archive'} ${selectedEmails} emails?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === 'delete' && permanentDelete
                ? 'These emails will be permanently removed and cannot be recovered.'
                : `You are about to ${actionLabel} more than ${bulkActionConfirmationThreshold} emails.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingAction) onAction(pendingAction);
                setPendingAction(null);
              }}
            >
              {pendingAction === 'delete' && permanentDelete ? 'Permanently delete' : 'Continue'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
