import {
  useEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  Archive,
  Check,
  FileText,
  Flag,
  CalendarDays,
  Folder,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  Send,
  Star,
  Trash2,
  Columns2,
  Columns3,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
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
  messageThemeColors,
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
import {
  EMZERO_MESSAGE_COLORS,
  localDateKeyAfter,
  tomorrowDateKey,
  type EmzeroMessageColor,
} from '../../shared/message-keywords';
import { MoveToDialog } from './message-move';

export type MailboxSelection =
  | { kind: 'unified'; mailbox?: 'inbox' | 'starred' | 'drafts' | 'trash' }
  | { kind: 'search'; query: string }
  | { kind: 'folder'; account: AccountSummary; folder: MailFolderSummary };

export type MailLayout = 'list' | 'split';

export function useCompactMailList(forceCompact = false) {
  const ref = useRef<HTMLElement>(null);
  const [measuredCompact, setMeasuredCompact] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setMeasuredCompact(entry.contentRect.width < 760);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, compact: forceCompact || measuredCompact };
}

export function MailLayoutToggle({
  layout,
  onChange,
}: {
  layout: MailLayout;
  onChange: (layout: MailLayout) => void;
}) {
  const split = layout === 'split';
  return (
    <Button
      type="button"
      variant="ghost"
      className="header-tooltip px-3"
      aria-label={split ? 'Use list layout' : 'Use three-column layout'}
      data-tooltip={split ? 'Use list layout' : 'Use three-column layout'}
      onClick={() => onChange(split ? 'list' : 'split')}
    >
      {split ? <Columns2 className="size-4" /> : <Columns3 className="size-4" />}
    </Button>
  );
}

export function SidebarHeaderToggle({
  pinned,
  onToggle,
}: {
  pinned: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className="header-tooltip hidden px-3 lg:inline-flex"
      aria-label="Toggle main sidebar"
      data-tooltip={`Toggle main sidebar (${window.emzero?.platform === 'darwin' ? '⌘B' : 'Ctrl+B'})`}
      onClick={onToggle}
    >
      {pinned ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
    </Button>
  );
}

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

export function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="ml-auto min-w-5 shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-center text-[0.62rem] font-semibold tabular-nums leading-none text-secondary-foreground"
      aria-label={`${count} ${label}`}
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

const avatarColorClasses = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
] as const;

export function avatarInitials(label: string): string {
  const normalized = label.trim().replace(/^to:\s*/i, '');
  const localPart = normalized.includes('@') ? normalized.split('@')[0] : normalized;
  const parts = localPart.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase();
}

export function avatarColorClass(label: string): string {
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return avatarColorClasses[hash % avatarColorClasses.length];
}

export function safeAvatarUrl(value: string | null | undefined): string | null {
  return value && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/i.test(value)
    ? value
    : null;
}

export function conversationAvatarUrl(
  messages: MailMessageSummary[],
  account: AccountSummary,
): string | null {
  const ownAddresses = new Set(
    [account.email, account.username]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const addresses = messages.flatMap((message) => [...message.from, ...message.to]);
  const opponentAvatar = addresses.find(({ address, avatarUrl }) =>
    Boolean(
      safeAvatarUrl(avatarUrl) &&
      (!address || !ownAddresses.has(address.trim().toLowerCase())),
    ),
  );
  return safeAvatarUrl(opponentAvatar?.avatarUrl);
}

export function SenderAvatar({
  label,
  imageUrl,
  className,
}: {
  label: string;
  imageUrl?: string | null;
  className?: string;
}) {
  const safeImageUrl = safeAvatarUrl(imageUrl);
  if (safeImageUrl) {
    return (
      <img
        src={safeImageUrl}
        alt=""
        className={cn('size-7 rounded-full object-cover transition-opacity', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'grid size-7 place-items-center rounded-full text-[0.65rem] font-semibold tracking-wide text-white transition-opacity',
        avatarColorClass(label),
        className,
      )}
      aria-hidden="true"
    >
      {avatarInitials(label)}
    </span>
  );
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

export function hasRemoteImages(body: string): boolean {
  return /<img\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i.test(body);
}

export function htmlDocument(
  body: string,
  showQuoted: boolean,
  theme: Theme,
  loadRemoteImages = false,
): string {
  const quotedStyle = showQuoted
    ? ''
    : 'blockquote,.gmail_quote,.yahoo_quoted,.moz-cite-prefix,#divRplyFwdMsg{display:none!important}';
  const colors = messageThemeColors[theme];
  const imageSources = loadRemoteImages ? 'data: http: https:' : 'data:';
  const linkRelay = `<script>document.addEventListener('click',function(event){var link=event.target.closest('a[href]');if(!link)return;event.preventDefault();parent.postMessage({type:'emzero:open-link',url:link.href},'*')})</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline'; script-src 'sha256-WjIlQhU8kgACo60V/0qpiNd4Brn6ImW1j3ghP53B1Yg=';"><style>html{color-scheme:light;background:#fff;scrollbar-color:color-mix(in oklab,${colors.primary} 55%,transparent) transparent;scrollbar-width:thin}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{min-width:40px;min-height:40px;border:3px solid transparent;border-radius:999px;background:color-mix(in oklab,${colors.primary} 55%,transparent);background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:color-mix(in oklab,${colors.primary} 78%,transparent);background-clip:content-box}body{box-sizing:border-box;margin:0;padding:1.5rem;color:#202124;background:#fff;font:14px/1.55 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}a{color:#2457a7}img{max-width:100%;height:auto}table{max-width:100%}${quotedStyle}</style></head><body>${body}${linkRelay}</body></html>`;
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
      supportsEmzeroKeywords: boolean;
      notice?: string;
    }
  | { status: 'error'; message: string };

export interface UnifiedConversationItem {
  selection: FolderSelection;
  folders: MailFolderSummary[];
  conversation: MailConversation;
  supportsEmzeroKeywords: boolean;
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

export type ConversationAction =
  | 'read'
  | 'unread'
  | 'star'
  | 'unstar'
  | 'mark-important'
  | 'clear-important'
  | 'set-color'
  | 'clear-color'
  | 'move'
  | 'delete';

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
  metadata?: { dueDate?: string; color?: EmzeroMessageColor | null },
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
          : action === 'mark-important' || action === 'clear-important'
            ? await window.emzero.messages.setImportant(
                accountId,
                folderPath,
                uids,
                action === 'mark-important',
                metadata?.dueDate,
              )
          : action === 'set-color' || action === 'clear-color'
            ? await window.emzero.messages.setColor(
                accountId,
                folderPath,
                uids,
                action === 'set-color' ? (metadata?.color ?? null) : null,
              )
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

export function conversationWithImportanceValues(
  conversation: MailConversation,
  values: ReadonlyMap<string, { important: boolean; dueDate: string | null }>,
): MailConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => {
      const value = values.get(`${message.folderPath}:${message.uid}`);
      return value === undefined ? message : { ...message, ...value };
    }),
  };
}

export function dueDateLabel(dueDate: string | null): string {
  if (!dueDate) return 'No due date';
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  if (dueDate === todayKey) return 'Due today';
  if (dueDate === tomorrowDateKey(today)) return 'Due tomorrow';
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (dueDate < todayKey) return `Overdue · ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed)}`;
  return `Due ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed)}`;
}

export function dueDateRowClass(dueDate: string | null): string | undefined {
  if (!dueDate) return undefined;
  const today = localDateKeyAfter(0);
  if (dueDate < today) return 'bg-red-500/10 hover:bg-red-500/15';
  if (dueDate === today) return 'bg-yellow-500/10 hover:bg-yellow-500/15';
  return undefined;
}

const messageColorClasses: Record<EmzeroMessageColor, { background: string; text: string }> = {
  red: { background: 'bg-red-500', text: 'text-red-500' },
  orange: { background: 'bg-orange-500', text: 'text-orange-500' },
  yellow: { background: 'bg-yellow-400', text: 'text-yellow-500' },
  green: { background: 'bg-green-500', text: 'text-green-500' },
  blue: { background: 'bg-blue-500', text: 'text-blue-500' },
  purple: { background: 'bg-purple-500', text: 'text-purple-500' },
};

export function messageColorBackgroundClass(color: EmzeroMessageColor): string {
  return messageColorClasses[color].background;
}

export function messageColorTextClass(color: EmzeroMessageColor): string {
  return messageColorClasses[color].text;
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
  important,
  dueDate,
  color,
  supportsEmzeroKeywords,
  busy,
  confirmPermanentDelete,
  onSetUnread,
  onSetFlagged,
  onSetImportant,
  onSetColor,
  onMove,
  onDelete,
  deleteButtonRef,
}: {
  accounts: AccountSummary[];
  sourceAccountId: string;
  folders: MailFolderSummary[];
  sourcePath: string;
  messageCount: number;
  unread: boolean;
  flagged: boolean;
  important: boolean;
  dueDate: string | null;
  color: EmzeroMessageColor | null;
  supportsEmzeroKeywords: boolean;
  busy: boolean;
  confirmPermanentDelete: boolean;
  onSetUnread: (unread: boolean) => void;
  onSetFlagged: (flagged: boolean) => void;
  onSetImportant: (important: boolean, dueDate?: string) => void;
  onSetColor: (color: EmzeroMessageColor | null) => void;
  onMove: (destination: MessageMoveDestination) => void;
  onDelete: () => void;
  deleteButtonRef?: Ref<HTMLButtonElement>;
}) {
  const [dueDialogOpen, setDueDialogOpen] = useState(false);
  const [colorDialogOpen, setColorDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuPlacement, setMoreMenuPlacement] = useState<'above' | 'below'>('below');
  const [customDueDate, setCustomDueDate] = useState(dueDate ?? tomorrowDateKey());
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const archive = findArchiveFolder(folders);
  const unreadLabel = unread ? 'Mark as read' : 'Mark as unread';

  useEffect(() => {
    if (!moreMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (moreMenuRef.current?.contains(event.target as Node)) return;
      const focusedElement = document.activeElement;
      if (
        focusedElement instanceof HTMLElement &&
        moreMenuRef.current?.contains(focusedElement)
      ) {
        focusedElement.blur();
      }
      setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [moreMenuOpen]);

  const runMenuAction = (action: () => void) => {
    setMoreMenuOpen(false);
    action();
  };
  const menuItemClass = 'h-8 w-full justify-start rounded-md px-2 text-xs';
  const deleteButton = (
    <Button
      ref={deleteButtonRef}
      variant="ghost"
      className="size-8 px-0 text-danger hover:text-danger"
      aria-label="Delete conversation"
      title="Delete conversation"
      onClick={confirmPermanentDelete ? undefined : onDelete}
    >
      <Trash2 className="size-4" />
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
      <div
        ref={moreMenuRef}
        className="relative"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          setMoreMenuOpen(false);
          moreMenuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
        }}
      >
        <Button
          variant="ghost"
          className="size-8 px-0"
          aria-label="More conversation actions"
          title="More conversation actions"
          aria-haspopup="menu"
          aria-expanded={moreMenuOpen}
          disabled={busy}
          onClick={(event) => {
            if (moreMenuOpen) {
              setMoreMenuOpen(false);
              if (event.detail > 0) event.currentTarget.blur();
              return;
            }
            setMoreMenuPlacement(
              window.innerHeight - event.currentTarget.getBoundingClientRect().bottom < 220
                ? 'above'
                : 'below',
            );
            setMoreMenuOpen(true);
          }}
        >
          <MoreHorizontal className="size-4" />
        </Button>
        {moreMenuOpen && (
          <div
            role="menu"
            aria-label="More conversation actions"
            className={cn(
              'absolute right-0 z-50 w-48 rounded-lg border border-border bg-card p-1 shadow-lg',
              moreMenuPlacement === 'above'
                ? 'bottom-[calc(100%+0.25rem)]'
                : 'top-[calc(100%+0.25rem)]',
            )}
          >
            <Button
              autoFocus
              variant="ghost"
              role="menuitem"
              className={menuItemClass}
              onClick={() => runMenuAction(() => onSetFlagged(!flagged))}
            >
              <Star className={cn('size-4', flagged && 'fill-primary text-primary')} />
              {flagged ? 'Remove star' : 'Add star'}
            </Button>
            {supportsEmzeroKeywords && (
              <>
                <Button
                  variant="ghost"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => runMenuAction(() => onSetImportant(!important))}
                >
                  <Flag className={cn('size-4', important && 'fill-danger text-danger')} />
                  {important ? 'Remove important' : 'Mark important'}
                </Button>
                <Button
                  variant="ghost"
                  role="menuitem"
                  className={cn(menuItemClass, dueDate && 'h-auto py-2')}
                  onClick={() => runMenuAction(() => {
                    setCustomDueDate(dueDate ?? tomorrowDateKey());
                    setDueDialogOpen(true);
                  })}
                >
                  <CalendarDays className="size-4" />
                  <span className="min-w-0 text-left">
                    <span className="block">{dueDate ? dueDateLabel(dueDate) : 'Set due date'}</span>
                    {dueDate && (
                      <span className="block text-[10px] text-muted-foreground">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${dueDate}T00:00:00`))}
                      </span>
                    )}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => runMenuAction(() => setColorDialogOpen(true))}
                >
                  <Palette className={cn('size-4', color && messageColorTextClass(color))} />
                  {color ? 'Change color' : 'Assign color'}
                </Button>
              </>
            )}
            {archive && archive.path !== sourcePath && (
              <Button
                variant="ghost"
                role="menuitem"
                className={menuItemClass}
                onClick={() => runMenuAction(() => onMove({ accountId: sourceAccountId, folderPath: archive.path }))}
              >
                <Archive className="size-4" />
                Archive
              </Button>
            )}
            <Button
              variant="ghost"
              role="menuitem"
              className={menuItemClass}
              disabled={busy || accounts.length === 0}
              onClick={() => runMenuAction(() => setMoveDialogOpen(true))}
            >
              <Folder className="size-4" />
              Move to folder
            </Button>
          </div>
        )}
      </div>
      <MoveToDialog
        accounts={accounts}
        sourceAccountId={sourceAccountId}
        sourceFolders={folders}
        sourcePath={sourcePath}
        count={messageCount}
        busy={busy}
        hideTrigger
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        onMove={onMove}
      />
      {supportsEmzeroKeywords && (
        <>
          <Dialog open={dueDialogOpen} onOpenChange={(open) => {
            setDueDialogOpen(open);
            if (open) setCustomDueDate(dueDate ?? tomorrowDateKey());
          }}>
            <DialogContent className="w-[min(28rem,calc(100%-2rem))]">
              <DialogHeader>
                <DialogTitle>Set due date</DialogTitle>
                <DialogDescription>Mark this conversation as important and choose when it is due.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Today', localDateKeyAfter(0)],
                  ['Tomorrow', localDateKeyAfter(1)],
                  ['Next week', localDateKeyAfter(7)],
                ].map(([label, value]) => (
                  <Button key={label} variant="secondary" onClick={() => { onSetImportant(true, value); setDueDialogOpen(false); }}>
                    {label}
                  </Button>
                ))}
              </div>
              <label className="space-y-2 text-sm font-medium">
                <span className="block">Custom date</span>
                <input type="date" className="field" value={customDueDate} onChange={(event) => setCustomDueDate(event.target.value)} />
              </label>
              <div className="flex justify-between gap-2">
                {important ? <Button variant="ghost" onClick={() => { onSetImportant(false); setDueDialogOpen(false); }}>Remove important</Button> : <span />}
                <Button disabled={!customDueDate} onClick={() => { onSetImportant(true, customDueDate); setDueDialogOpen(false); }}>Set due date</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={colorDialogOpen} onOpenChange={setColorDialogOpen}>
            <DialogContent className="w-[min(25rem,calc(100%-2rem))]">
              <DialogHeader>
                <DialogTitle>Assign color</DialogTitle>
                <DialogDescription>Choose a color that will synchronize with other Emzero clients.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                {EMZERO_MESSAGE_COLORS.map((candidate) => (
                  <Button key={candidate} variant={candidate === color ? 'default' : 'secondary'} className="justify-start capitalize" onClick={() => { onSetColor(candidate); setColorDialogOpen(false); }}>
                    <span className={cn('size-3 rounded-full', messageColorBackgroundClass(candidate))} />
                    {candidate}
                  </Button>
                ))}
              </div>
              {color && <Button variant="ghost" onClick={() => { onSetColor(null); setColorDialogOpen(false); }}>Remove color</Button>}
            </DialogContent>
          </Dialog>
        </>
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
