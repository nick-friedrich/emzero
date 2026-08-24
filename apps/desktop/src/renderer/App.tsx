import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  Folder,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MailOpen,
  Menu,
  Paperclip,
  Palette,
  PenLine,
  Plus,
  RefreshCw,
  Reply,
  Send,
  Server,
  Settings2,
  Star,
  Trash2,
  Type,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  interfaceFonts,
  messageThemeColors,
  themeColorSchemes,
  themes,
  useTheme,
  type InterfaceFont,
  type Theme,
} from '@/theme';
import type {
  AccountDraft,
  AccountSummary,
  BulkMessageJobProgress,
  BulkMessageJobRequest,
  BulkMessageJobStartResult,
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSummary,
  MailProvider,
  MailSendDraft,
  MailSyncStatus,
  RecipientSuggestion,
} from '../shared/accounts';
import {
  accountUnreadCount,
  defaultAccountName,
  displayFolderName,
  findInboxFolder,
} from '../shared/accounts';
import {
  groupMessagesWithRelated,
  splitQuotedText,
  type MailConversation,
} from '../shared/conversations';
import {
  createReplyDraft,
  parseAddressList,
  replyRecipients,
  validateReplyDraft,
  validateSendDraft,
} from '../shared/replies';

const initialDraft: AccountDraft = {
  name: '',
  email: '',
  username: '',
  password: '',
  imap: { host: '', port: 993, secure: true },
  smtp: { host: '', port: 465, secure: true },
};

const skipSendConfirmationStorageKey = 'emzero-skip-send-confirmation';

function storedSkipSendConfirmation(): boolean {
  try {
    return window.localStorage.getItem(skipSendConfirmationStorageKey) === 'true';
  } catch {
    return false;
  }
}

function sendShortcutLabel(): string {
  return window.emzero.platform === 'darwin' ? '⌘ + Enter' : 'Ctrl + Enter';
}

function useSendShortcut(enabled: boolean, onSend: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key !== 'Enter' ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSend();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, onSend]);
}

interface Status {
  kind: 'success' | 'error';
  message: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-foreground">
      <span className="mb-2 block">{label}</span>
      {children}
    </label>
  );
}

function ServerFields({
  title,
  protocol,
  server,
  onChange,
}: {
  title: string;
  protocol: 'imap' | 'smtp';
  server: AccountDraft['imap'];
  onChange: (
    protocol: 'imap' | 'smtp',
    key: 'host' | 'port' | 'secure',
    value: string | number | boolean,
  ) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-4 text-sm font-semibold">{title}</legend>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Host">
          <input
            className="field"
            placeholder={`${protocol}.example.com`}
            value={server.host}
            onChange={(event) => onChange(protocol, 'host', event.target.value)}
          />
        </Field>
        <Field label="Port">
          <input
            className="field"
            type="number"
            min="1"
            max="65535"
            value={server.port}
            onChange={(event) => onChange(protocol, 'port', Number(event.target.value))}
          />
        </Field>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input
          className="size-4 accent-primary"
          type="checkbox"
          checked={server.secure}
          onChange={(event) => onChange(protocol, 'secure', event.target.checked)}
        />
        Use implicit TLS
      </label>
    </fieldset>
  );
}

function AccountSetup({
  providers,
  canCancel,
  onCancel,
  onSaved,
}: {
  providers: MailProvider[];
  canCancel: boolean;
  onCancel: () => void;
  onSaved: (account: AccountSummary) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [preset, setPreset] = useState('custom');
  const [detection, setDetection] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const choosePreset = (nextPreset: string) => {
    setPreset(nextPreset);
    const provider = providers.find((candidate) => candidate.id === nextPreset);
    if (provider) {
      setDraft((current) => ({ ...current, imap: provider.imap, smtp: provider.smtp }));
    }
    setDetection(null);
    setStatus(null);
  };

  useEffect(() => {
    const email = draft.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      window.emzero.providers
        .discover(email)
        .then(({ provider, detectedBy }) => {
          if (!active || !provider) return;
          setPreset(provider.id);
          setDraft((current) =>
            current.email.trim() === email
              ? { ...current, imap: provider.imap, smtp: provider.smtp }
              : current,
          );
          setDetection(
            detectedBy === 'mx'
              ? `${provider.name} detected from this domain's mail records.`
              : `${provider.name} detected from the email address.`,
          );
        })
        .catch(() => undefined);
    }, 450);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft.email]);

  const setServer = (
    protocol: 'imap' | 'smtp',
    key: 'host' | 'port' | 'secure',
    value: string | number | boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      [protocol]: { ...current[protocol], [key]: value },
    }));
    setStatus(null);
  };

  const run = async (action: 'test' | 'save') => {
    setBusy(action);
    setStatus(null);
    try {
      const result = await window.emzero.accounts[action](draft);
      setStatus({ kind: result.ok ? 'success' : 'error', message: result.message });
      if (result.ok && result.account) onSaved(result.account);
    } catch {
      setStatus({ kind: 'error', message: 'Emzero could not complete this request.' });
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run('save');
  };

  return (
    <section className="min-w-0 overflow-y-auto bg-background px-4 pb-8 pt-20 sm:px-8 lg:p-12">
      <form className="mx-auto max-w-3xl" onSubmit={submit}>
        <div className="mb-8">
          <div className="mb-4 grid size-11 place-items-center rounded-xl border border-border bg-card shadow-sm">
            <Server className="size-5 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Connect an email account</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Emzero connects directly to your mail provider. Your password is encrypted
            by your operating system and never exposed to the web view.
          </p>
        </div>

        <div className="space-y-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-4 text-sm font-semibold">Account details</legend>
            <Field label="Email address">
              <input
                className="field"
                type="email"
                placeholder="you@example.com"
                value={draft.email}
                onChange={(event) => {
                  const email = event.target.value;
                  setDetection(null);
                  setDraft((current) => ({
                    ...current,
                    email,
                    name:
                      current.name === defaultAccountName(current.email)
                        ? defaultAccountName(email)
                        : current.name,
                    username: current.username === current.email ? email : current.username,
                  }));
                }}
                autoComplete="email"
              />
            </Field>
            <Field label="Username">
              <input
                className="field"
                placeholder="Usually your email address"
                value={draft.username}
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                autoComplete="username"
              />
            </Field>
            <Field label="Account name">
              <input
                className="field"
                placeholder="Uses the email address by default"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="Provider">
              <div className="relative">
                <select
                  className="field appearance-none pr-9"
                  value={preset}
                  onChange={(event) => choosePreset(event.target.value)}
                >
                  <option value="custom">Custom IMAP</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
              </div>
              {detection && (
                <span className="mt-2 flex items-center gap-1.5 text-xs font-normal text-success">
                  <CheckCircle2 className="size-3.5" />
                  {detection}
                </span>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Password or app password">
                <input
                  className="field"
                  type="password"
                  value={draft.password}
                  onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                  autoComplete="current-password"
                />
              </Field>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <LockKeyhole className="size-3.5" />
                Some providers require an app-specific password.
              </p>
            </div>
          </fieldset>

          <div className="h-px bg-border" />

          <div className="grid gap-7 md:grid-cols-2">
            <ServerFields
              title="Incoming mail (IMAP)"
              protocol="imap"
              server={draft.imap}
              onChange={setServer}
            />
            <ServerFields
              title="Outgoing mail (SMTP)"
              protocol="smtp"
              server={draft.smtp}
              onChange={setServer}
            />
          </div>
        </div>

        {status && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
              status.kind === 'success'
                ? 'border-success/25 bg-success/8 text-success'
                : 'border-danger/25 bg-danger/8 text-danger'
            }`}
            role="status"
          >
            {status.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{status.message}</span>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <div>
            {canCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void run('test')}
            >
              {busy === 'test' && <LoaderCircle className="size-4 animate-spin" />}
              Test connection
            </Button>
            <Button type="submit" disabled={busy !== null}>
              {busy === 'save' && <LoaderCircle className="size-4 animate-spin" />}
              Connect account
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

type MailboxSelection =
  | { kind: 'unified' }
  | { kind: 'folder'; account: AccountSummary; folder: MailFolderSummary };

type FolderSelection = Extract<MailboxSelection, { kind: 'folder' }>;

type FolderLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; folders: MailFolderSummary[] }
  | { status: 'error'; message: string };

function FolderIcon({ specialUse }: { specialUse: string | null }) {
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

function UnreadBadge({ count }: { count: number }) {
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

function addressLabel(addresses: MailMessageSummary['from']): string {
  if (addresses.length === 0) return 'Unknown sender';
  return [...new Map(addresses.map((address) => [address.address ?? address.name, address])).values()]
    .map(({ name, address }) => name || address || 'Unknown sender')
    .join(', ');
}

function addressDetails(addresses: MailMessageSummary['from']): string {
  if (addresses.length === 0) return 'Unknown';
  return addresses
    .map(({ name, address }) => {
      if (name && address) return `${name} <${address}>`;
      return name || address || 'Unknown';
    })
    .join(', ');
}

function conversationOpponent(
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

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function htmlDocument(body: string, showQuoted: boolean, theme: Theme): string {
  const quotedStyle = showQuoted
    ? ''
    : 'blockquote,.gmail_quote,.yahoo_quoted,.moz-cite-prefix,#divRplyFwdMsg{display:none!important}';
  const colors = messageThemeColors[theme];
  const colorScheme = themeColorSchemes[theme];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${colorScheme}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>html{color-scheme:${colorScheme};background:${colors.background}}body{box-sizing:border-box;margin:0;padding:1.5rem;color:${colors.foreground};background:${colors.background};font:14px/1.65 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}a{color:inherit}img{max-width:100%;height:auto}table{max-width:100%}${quotedStyle}</style></head><body>${body}</body></html>`;
}

function messageDate(value: string | null): string {
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

type MessageLoadState =
  | { status: 'loading' }
  | {
      status: 'loaded';
      messages: MailMessageSummary[];
      relatedMessages: MailMessageSummary[];
      total: number;
      notice?: string;
    }
  | { status: 'error'; message: string };

interface UnifiedConversationItem {
  selection: FolderSelection;
  conversation: MailConversation;
}

interface UnifiedAccountFailure {
  account: AccountSummary;
  message: string;
}

type UnifiedInboxLoadState =
  | { status: 'loading' }
  | {
      status: 'loaded';
      items: UnifiedConversationItem[];
      failures: UnifiedAccountFailure[];
      notices: UnifiedAccountFailure[];
      loadedMessages: number;
      totalMessages: number;
    };

type MessageDetailLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; message: MailMessageDetail }
  | { status: 'error'; message: string };

type ConversationAction = 'read' | 'unread' | 'delete';

type StartBulkOperation = (
  request: BulkMessageJobRequest,
  location: string,
) => Promise<BulkMessageJobStartResult>;

const bulkActionConfirmationThreshold = 10;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return (
    target instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'reset', 'submit'].includes(target.type)
  );
}

function messageCountInFolder(conversation: MailConversation, folderPath: string): number {
  return conversation.messages.filter((message) => message.folderPath === folderPath).length;
}

async function performConversationAction(
  accountId: string,
  folderPath: string,
  conversation: MailConversation,
  action: ConversationAction,
): Promise<string | null> {
  const uids = conversation.messages
    .filter((message) => message.folderPath === folderPath)
    .map((message) => message.uid);
  const result =
    action === 'delete'
      ? await window.emzero.messages.delete(accountId, folderPath, uids)
      : await window.emzero.messages.setUnread(accountId, folderPath, uids, action === 'unread');
  return result.ok ? null : result.message ?? 'The action could not be completed.';
}

function conversationWithUnreadValues(
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

function conversationWithMessage(
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

function ConversationActions({
  unread,
  busy,
  confirmPermanentDelete,
  onSetUnread,
  onDelete,
}: {
  unread: boolean;
  busy: boolean;
  confirmPermanentDelete: boolean;
  onSetUnread: (unread: boolean) => void;
  onDelete: () => void;
}) {
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

function SelectionCheckbox({
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
  onChange: () => void;
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
        onChange={onChange}
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

function BulkActionToolbar({
  selectedRows,
  selectedEmails,
  totalRows,
  busy,
  permanentDelete,
  onToggleAll,
  onClear,
  onAction,
}: {
  selectedRows: number;
  selectedEmails: number;
  totalRows: number;
  busy: boolean;
  permanentDelete: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  onAction: (action: ConversationAction) => void;
}) {
  const [pendingAction, setPendingAction] = useState<ConversationAction | null>(null);
  const allSelected = selectedRows === totalRows;
  const needsConfirmation = (action: ConversationAction) =>
    selectedEmails > bulkActionConfirmationThreshold || (action === 'delete' && permanentDelete);
  const requestAction = (action: ConversationAction) => {
    if (needsConfirmation(action)) setPendingAction(action);
    else onAction(action);
  };
  const actionLabel =
    pendingAction === 'read'
      ? 'mark as read'
      : pendingAction === 'unread'
        ? 'mark as unread'
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
                : `${pendingAction === 'delete' ? 'Delete' : pendingAction === 'read' ? 'Mark as read' : 'Mark as unread'} ${selectedEmails} emails?`}
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

function MessageBody({ message }: { message: MailMessageDetail }) {
  const { theme } = useTheme();
  const [view, setView] = useState<'html' | 'text'>('html');
  const [showQuoted, setShowQuoted] = useState(false);
  const textParts = splitQuotedText(message.text);
  const hasQuotedText = view === 'html' ? message.htmlHasQuotedText : Boolean(textParts.quoted);

  return (
    <>
      {(message.cc.length > 0 || message.replyTo.length > 0) && (
        <div className="mb-4 text-xs leading-5 text-muted-foreground">
          {message.cc.length > 0 && <p>Cc: {addressDetails(message.cc)}</p>}
          {message.replyTo.length > 0 && <p>Reply-To: {addressDetails(message.replyTo)}</p>}
        </div>
      )}
      {message.html && (
        <div className="flex justify-end gap-1" aria-label="Message format">
          <Button
            variant={view === 'html' ? 'secondary' : 'ghost'}
            className="h-8 px-3 text-xs"
            onClick={() => setView('html')}
          >
            HTML
          </Button>
          <Button
            variant={view === 'text' ? 'secondary' : 'ghost'}
            className="h-8 px-3 text-xs"
            onClick={() => setView('text')}
          >
            Plain text
          </Button>
        </div>
      )}

      {message.html && view === 'html' ? (
        <iframe
          className="mt-4 h-[55vh] min-h-80 w-full rounded-md border border-border bg-card"
          title="Email content"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={htmlDocument(message.html, showQuoted, theme)}
        />
      ) : (
        <div className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
          {textParts.visible || 'No new text in this reply.'}
          {showQuoted && textParts.quoted && (
            <div className="mt-5 border-l-2 border-border pl-4 text-muted-foreground">
              {textParts.quoted}
            </div>
          )}
        </div>
      )}

      {hasQuotedText && (
        <Button
          variant="ghost"
          className="mt-4 h-8 px-3 text-xs text-muted-foreground"
          onClick={() => setShowQuoted((current) => !current)}
        >
          {showQuoted ? 'Hide quoted text' : 'Show quoted text'}
        </Button>
      )}

      {message.attachments.some(({ related }) => !related) && (
        <section className="mt-6 border-t border-border pt-5" aria-label="Attachments">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="size-4" />
            Attachments
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments
              .filter(({ related }) => !related)
              .map((attachment, index) => (
                <div
                  key={`${attachment.filename}:${index}`}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs"
                >
                  <span className="font-medium">{attachment.filename}</span>
                  <span className="ml-2 text-muted-foreground">{fileSize(attachment.size)}</span>
                </div>
              ))}
          </div>
        </section>
      )}
    </>
  );
}

function ReplyComposer({
  account,
  summary,
  message,
  onSent,
}: {
  account: AccountSummary;
  summary: MailMessageSummary;
  message: MailMessageDetail;
  onSent: (message: MailMessageSummary) => void;
}) {
  const recipients = replyRecipients(account, message);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<MailSendDraft | null>(null);
  const confirmationActionRef = useRef<HTMLButtonElement>(null);

  const deliver = async (draft: MailSendDraft) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.emzero.messages.sendReply(account.id, draft);
      setStatus({
        kind: result.ok ? 'success' : 'error',
        message: result.message ?? (result.ok ? 'Reply sent.' : 'Could not send reply.'),
      });
      if (result.ok) {
        if (result.sentMessage) onSent(result.sentMessage);
        setText('');
        setOpen(false);
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not send reply.' });
    } finally {
      setBusy(false);
    }
  };

  const requestSend = () => {
    const draft = createReplyDraft(account, summary, message, text);
    const validationError = validateReplyDraft(draft);
    if (validationError) {
      setStatus({ kind: 'error', message: validationError });
      return;
    }
    if (storedSkipSendConfirmation()) {
      void deliver(draft);
      return;
    }
    setPendingDraft(draft);
    setDontShowAgain(false);
    setConfirmationOpen(true);
  };

  useSendShortcut(open && !busy && !confirmationOpen, requestSend);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    requestSend();
  };

  if (!open) {
    return (
      <div className="mt-6 border-t border-border pt-5">
        <Button
          variant="secondary"
          disabled={recipients.length === 0}
          title={recipients.length === 0 ? 'This message has no valid reply address.' : undefined}
          onClick={() => {
            setOpen(true);
            setStatus(null);
          }}
        >
          <Reply className="size-4" />
          Reply
        </Button>
        {status && (
          <span
            className={cn(
              'ml-3 text-xs',
              status.kind === 'success' ? 'text-success' : 'text-danger',
            )}
            role="status"
          >
            {status.message}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <form
        className="mt-6 border-t border-border pt-5"
        onSubmit={submit}
      >
        <div className="mb-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Reply className="size-4 shrink-0" />
        <span className="shrink-0">Reply to</span>
        <span className="truncate font-medium text-foreground">{addressDetails(recipients)}</span>
        </div>
        <textarea
          className="field min-h-36 resize-y leading-6"
          value={text}
          placeholder="Write a reply…"
          aria-label="Reply message"
          autoFocus
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setStatus(null);
          }}
        />
        {status?.kind === 'error' && (
          <p className="mt-2 text-xs text-danger" role="status">
            {status.message}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setText('');
              setStatus(null);
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || !text.trim()}
            title="Send reply (Ctrl+Enter)"
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send reply
          </Button>
        </div>
        <p className="mt-2 text-right text-[0.68rem] text-muted-foreground">
          Send with {sendShortcutLabel()}
        </p>
      </form>
      <AlertDialog
        open={confirmationOpen}
        onOpenChange={(nextOpen) => {
          setConfirmationOpen(nextOpen);
          if (!nextOpen) setPendingDraft(null);
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            confirmationActionRef.current?.focus();
          }}
          onKeyDownCapture={(event) => {
            if (event.key === 'Enter' && !event.repeat) {
              event.preventDefault();
              event.stopPropagation();
              confirmationActionRef.current?.click();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Send this reply?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send the reply immediately and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDraft && (
            <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
              <p className="truncate">
                <span className="text-muted-foreground">From: </span>
                {account.email}
              </p>
              <p className="mt-1 truncate">
                <span className="text-muted-foreground">To: </span>
                {addressDetails(pendingDraft.to)}
              </p>
              <p className="mt-1 truncate">
                <span className="text-muted-foreground">Subject: </span>
                {pendingDraft.subject}
              </p>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              className="size-4 accent-primary"
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
            />
            Don’t show this confirmation again
          </label>
          <p className="text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5">Enter</kbd>{' '}
            to send or <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5">Esc</kbd>{' '}
            to cancel. Open this dialog with {sendShortcutLabel()}.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={confirmationActionRef}
              variant="default"
              onClick={() => {
                if (!pendingDraft) return;
                const draft = pendingDraft;
                if (dontShowAgain) {
                  try {
                    window.localStorage.setItem(skipSendConfirmationStorageKey, 'true');
                  } catch {
                    // Sending should still work if preferences cannot be persisted.
                  }
                }
                setPendingDraft(null);
                void deliver(draft);
              }}
            >
              <Send className="size-4" />
              Send reply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ThreadMessageCard({
  selection,
  summary,
  defaultExpanded,
  onReplySent,
}: {
  selection: FolderSelection;
  summary: MailMessageSummary;
  defaultExpanded: boolean;
  onReplySent: (message: MailMessageSummary) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [state, setState] = useState<MessageDetailLoadState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!expanded || state.status !== 'loading') return;
    let active = true;
    void window.emzero.messages
      .get(selection.account.id, summary.folderPath, summary.uid)
      .then((result) => {
        if (!active) return;
        setState(
          result.ok && result.messageDetail
            ? { status: 'loaded', message: result.messageDetail }
            : { status: 'error', message: result.message ?? 'Could not load message.' },
        );
      })
      .catch(() => {
        if (active) setState({ status: 'error', message: 'Could not load message.' });
      });
    return () => {
      active = false;
    };
  }, [expanded, refreshKey, selection.account.id, state.status, summary.folderPath, summary.uid]);

  const retry = () => {
    setState({ status: 'loading' });
    setRefreshKey((current) => current + 1);
  };

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-account text-xs font-semibold text-primary">
            {addressLabel(summary.from).charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{addressLabel(summary.from)}</p>
            <p className="truncate text-xs text-muted-foreground">To: {addressLabel(summary.to)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <time dateTime={summary.sentAt ?? summary.receivedAt ?? undefined}>
            {messageDate(summary.sentAt ?? summary.receivedAt)}
          </time>
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-5">
          {state.status === 'loading' && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Loading message
            </div>
          )}
          {state.status === 'error' && (
            <div className="rounded-md bg-secondary p-4 text-sm">
              <p className="text-danger">{state.message}</p>
              <Button className="mt-3" variant="ghost" onClick={retry}>
                <RefreshCw className="size-4" />
                Try again
              </Button>
            </div>
          )}
          {state.status === 'loaded' && (
            <>
              <MessageBody message={state.message} />
              <ReplyComposer
                account={selection.account}
                summary={summary}
                message={state.message}
                onSent={onReplySent}
              />
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ConversationReader({
  selection,
  conversation,
  onBack,
  busy,
  actionError,
  onSetUnread,
  onDelete,
  onReplySent,
}: {
  selection: FolderSelection;
  conversation: MailConversation;
  onBack: () => void;
  busy: boolean;
  actionError: string | null;
  onSetUnread: (unread: boolean) => void;
  onDelete: () => void;
  onReplySent: (message: MailMessageSummary) => void;
}) {
  const unread = conversation.messages.some(
    (message) => message.folderPath === selection.folder.path && message.unread,
  );
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card py-3 pl-16 pr-4 lg:px-4">
        <Button variant="ghost" className="px-3" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <span className="truncate text-sm text-muted-foreground">
          {selection.account.name} / {displayFolderName(selection.folder)}
        </span>
        <div className="ml-auto">
          <ConversationActions
            unread={unread}
            busy={busy}
            confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
            onSetUnread={onSetUnread}
            onDelete={onDelete}
          />
        </div>
      </header>
      {actionError && (
        <div className="border-b border-danger/20 bg-danger/8 px-4 py-3 text-xs text-danger">
          {actionError}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-7 lg:px-10">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h1 className="min-w-0 text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              {conversation.subject}
            </h1>
            <span className="shrink-0 text-xs text-muted-foreground">
              {conversation.messages.length}{' '}
              {conversation.messages.length === 1 ? 'message' : 'messages'}
            </span>
          </div>
          <div className="space-y-3">
            {conversation.messages.map((message, index) => (
              <ThreadMessageCard
                key={`${message.folderPath}:${message.uid}`}
                selection={selection}
                summary={message}
                defaultExpanded={index === 0}
                onReplySent={onReplySent}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageList({
  selection,
  onStartBulkOperation,
}: {
  selection: FolderSelection;
  onStartBulkOperation: StartBulkOperation;
}) {
  const [state, setState] = useState<MessageLoadState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedConversation, setSelectedConversation] = useState<MailConversation | null>(null);
  const pendingActions = useRef(new Set<string>());
  const [busyConversations, setBusyConversations] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

      let relatedMessages: MailMessageSummary[] = [];
      const notices = [result.message];
      if (selection.folder.specialUse !== '\\Sent') {
        const folderResult = await window.emzero.folders.list(
          selection.account.id,
          refreshKey > 0,
        );
        const sentFolder = folderResult.ok
          ? folderResult.folders.find(
              (folder) => folder.selectable && folder.specialUse === '\\Sent',
            )
          : undefined;
        notices.push(folderResult.message);
        if (sentFolder && sentFolder.path !== selection.folder.path) {
          const sentResult = await window.emzero.messages.list(
            selection.account.id,
            sentFolder.path,
            refreshKey > 0,
          );
          if (sentResult.ok) {
            notices.push(sentResult.message);
            relatedMessages = sentResult.messages.map((message) => ({
              ...message,
              folderPath: sentFolder.path,
            }));
          }
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
    setState({ status: 'loading' });
    setRefreshKey((current) => current + 1);
  };

  const showRecipients = selection.folder.specialUse === '\\Sent';
  const conversations = useMemo(
    () =>
      state.status === 'loaded'
        ? groupMessagesWithRelated(state.messages, state.relatedMessages)
        : [],
    [state],
  );
  const selectedConversations = conversations.filter((conversation) =>
    selectedConversationIds.has(conversation.id),
  );
  const selectedEmailCount = selectedConversations.reduce(
    (total, conversation) => total + messageCountInFolder(conversation, selection.folder.path),
    0,
  );

  useEffect(() => {
    if (selectedConversation) return;
    const handleSelectAll = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key.toLowerCase() !== 'a' ||
        (!event.ctrlKey && !event.metaKey) ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      setSelectedConversationIds(new Set(conversations.map((conversation) => conversation.id)));
    };
    window.addEventListener('keydown', handleSelectAll);
    return () => window.removeEventListener('keydown', handleSelectAll);
  }, [conversations, selectedConversation]);

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
          if (progress.action === 'delete') {
            const removed = current.messages.filter((message) => processed.has(message.uid)).length;
            return {
              ...current,
              messages: current.messages.filter((message) => !processed.has(message.uid)),
              total: Math.max(0, current.total - removed),
            };
          }
          const unread = progress.action === 'unread';
          return {
            ...current,
            messages: current.messages.map((message) =>
              processed.has(message.uid) ? { ...message, unread } : message,
            ),
          };
        });
      }),
    [selection.account.id, selection.folder.path],
  );

  const runAction = async (conversation: MailConversation, action: ConversationAction) => {
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

    if (action !== 'delete') {
      const unread = action === 'unread';
      updateUnread(new Map([...keys].map((key) => [key, unread])));
    }

    try {
      const error = await performConversationAction(
        selection.account.id,
        selection.folder.path,
        conversation,
        action,
      );
      if (error) {
        setActionError(error);
        if (action !== 'delete') updateUnread(previousUnread);
        return false;
      }
      if (action === 'delete') {
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
      }
      return true;
    } catch {
      setActionError('The action could not be completed.');
      if (action !== 'delete') updateUnread(previousUnread);
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

  const runBulkAction = async (action: ConversationAction) => {
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
          groups: [{ accountId: selection.account.id, folderPath: selection.folder.path, uids }],
        },
        displayFolderName(selection.folder),
      );
      if (result.ok) {
        setSelectedConversationIds(new Set());
      } else {
        setActionError(result.message ?? 'The bulk action could not be started.');
      }
    } finally {
      setBulkBusy(false);
    }
  };

  if (selectedConversation) {
    return (
      <ConversationReader
        key={selectedConversation.id}
        selection={selection}
        conversation={selectedConversation}
        onBack={() => setSelectedConversation(null)}
        busy={busyConversations.has(selectedConversation.id)}
        actionError={actionError}
        onSetUnread={(unread) =>
          void runAction(selectedConversation, unread ? 'unread' : 'read')
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
      />
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card py-4 pl-16 pr-4 lg:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {displayFolderName(selection.folder)}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {selection.account.name} · {selection.account.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state.status === 'loaded' && (
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
          selectedRows={selectedConversationIds.size}
          selectedEmails={selectedEmailCount}
          totalRows={conversations.length}
          busy={bulkBusy}
          permanentDelete={selection.folder.specialUse === '\\Trash'}
          onToggleAll={() =>
            setSelectedConversationIds(
              selectedConversationIds.size === conversations.length
                ? new Set()
                : new Set(conversations.map((conversation) => conversation.id)),
            )
          }
          onClear={() => setSelectedConversationIds(new Set())}
          onAction={(action) => void runBulkAction(action)}
        />
      )}

      {state.status === 'loaded' && state.messages.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Messages">
          {conversations.map((conversation) => {
            const latest = conversation.messages[0];
            const opponent = conversationOpponent(conversation.messages, selection.account);
            const date = latest.sentAt ?? latest.receivedAt;
            const unread = conversation.messages.some(
              (message) => message.folderPath === selection.folder.path && message.unread,
            );
            const flagged = conversation.messages.some((message) => message.flagged);
            return (
              <div
                key={conversation.id}
                className={`group flex min-w-0 items-center border-b border-border hover:bg-accent/60 ${selectedConversationIds.has(conversation.id) ? 'bg-accent/60' : ''}`}
                role="listitem"
              >
                <div className="pl-4 lg:pl-6" onClick={(event) => event.stopPropagation()}>
                  <SelectionCheckbox
                    checked={selectedConversationIds.has(conversation.id)}
                    className={cn(
                      'transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                      selectedConversationIds.size > 0 ? 'opacity-100' : 'opacity-0',
                    )}
                    label={`Select conversation: ${conversation.subject}`}
                    onChange={() =>
                      setSelectedConversationIds((current) => {
                        const next = new Set(current);
                        if (next.has(conversation.id)) next.delete(conversation.id);
                        else next.add(conversation.id);
                        return next;
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left focus-visible:bg-accent focus-visible:outline-none lg:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] lg:gap-4 lg:px-6"
                  onClick={() => {
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
                    className={`col-span-2 col-start-1 row-start-2 min-w-0 truncate pl-3.5 text-sm lg:col-auto lg:row-auto lg:pl-0 ${unread ? 'font-semibold' : ''}`}
                  >
                    {conversation.subject}
                    {conversation.messages.length > 1 && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        ({conversation.messages.length})
                      </span>
                    )}
                  </p>
                  <div className="col-start-2 row-start-1 flex items-center gap-3 text-xs text-muted-foreground lg:col-auto lg:row-auto">
                    {flagged && (
                      <Star className="size-3.5 fill-primary text-primary" aria-label="Flagged" />
                    )}
                    <time dateTime={date ?? undefined}>{messageDate(date)}</time>
                  </div>
                </button>
                <div className="pr-3 lg:pr-5">
                  <ConversationActions
                    unread={unread}
                    busy={busyConversations.has(conversation.id)}
                    confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
                    onSetUnread={(nextUnread) =>
                      void runAction(conversation, nextUnread ? 'unread' : 'read')
                    }
                    onDelete={() => void runAction(conversation, 'delete')}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function conversationTime(conversation: MailConversation): number {
  const latest = conversation.messages[0];
  const value = latest?.sentAt ?? latest?.receivedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function UnifiedInbox({
  accounts,
  onStartBulkOperation,
}: {
  accounts: AccountSummary[];
  onStartBulkOperation: StartBulkOperation;
}) {
  const [state, setState] = useState<UnifiedInboxLoadState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedItem, setSelectedItem] = useState<UnifiedConversationItem | null>(null);
  const pendingActions = useRef(new Set<string>());
  const [busyConversations, setBusyConversations] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
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

          const folder = findInboxFolder(folderResult.folders);
          if (!folder) {
            return { failure: { account, message: 'No selectable inbox folder was found.' } };
          }

          const sentFolder = folderResult.folders.find(
            (candidate) => candidate.selectable && candidate.specialUse === '\\Sent',
          );
          const [inboxResult, sentResult] = await Promise.all([
            window.emzero.messages.list(account.id, folder.path, refreshKey > 0),
            sentFolder && sentFolder.path !== folder.path
              ? window.emzero.messages.list(account.id, sentFolder.path, refreshKey > 0)
              : Promise.resolve(null),
          ]);
          if (!inboxResult.ok) {
            return {
              failure: {
                account,
                message: inboxResult.message ?? 'Could not load inbox messages.',
              },
            };
          }

          const messages = inboxResult.messages.map((message) => ({
            ...message,
            folderPath: folder.path,
          }));
          const relatedMessages =
            sentFolder && sentResult?.ok
              ? sentResult.messages.map((message) => ({
                  ...message,
                  folderPath: sentFolder.path,
                }))
              : [];
          const selection: FolderSelection = { kind: 'folder', account, folder };
          return {
            account,
            items: groupMessagesWithRelated(messages, relatedMessages).map((conversation) => ({
              selection,
              conversation,
            })),
            loadedMessages: messages.length,
            totalMessages: inboxResult.total,
            notices: [folderResult.message, inboxResult.message, sentResult?.message].filter(
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
  }, [accounts, refreshKey]);

  const refresh = () => {
    setSelectedItem(null);
    setSelectedItemKeys(new Set());
    setState({ status: 'loading' });
    setRefreshKey((current) => current + 1);
  };

  const itemKey = (item: UnifiedConversationItem) =>
    `${item.selection.account.id}:${item.conversation.id}`;
  const availableItems = useMemo(
    () => (state.status === 'loaded' ? state.items : []),
    [state],
  );
  const selectedItems = availableItems.filter((item) => selectedItemKeys.has(itemKey(item)));
  const selectedEmailCount = selectedItems.reduce(
    (total, item) =>
      total + messageCountInFolder(item.conversation, item.selection.folder.path),
    0,
  );

  useEffect(() => {
    if (selectedItem) return;
    const handleSelectAll = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key.toLowerCase() !== 'a' ||
        (!event.ctrlKey && !event.metaKey) ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      setSelectedItemKeys(
        new Set(availableItems.map((item) => `${item.selection.account.id}:${item.conversation.id}`)),
      );
    };
    window.addEventListener('keydown', handleSelectAll);
    return () => window.removeEventListener('keydown', handleSelectAll);
  }, [availableItems, selectedItem]);

  useEffect(
    () =>
      window.emzero.messages.onBulkJobProgress((progress) => {
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
        if (progress.action === 'delete') {
          const messages = item.conversation.messages.filter(
            (message) =>
              message.folderPath !== progress.folderPath || !processed.has(message.uid),
          );
          return messages.some((message) => message.folderPath === progress.folderPath)
            ? [{ ...item, conversation: { ...item.conversation, messages } }]
            : [];
        }
        const unread = progress.action === 'unread';
        return [
          {
            ...item,
            conversation: {
              ...item.conversation,
              messages: item.conversation.messages.map((message) =>
                message.folderPath === progress.folderPath && processed.has(message.uid)
                  ? { ...message, unread }
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
          progress.action === 'delete'
            ? Math.max(0, current.loadedMessages - affectedMessages)
            : current.loadedMessages,
        totalMessages:
          progress.action === 'delete'
            ? Math.max(0, current.totalMessages - affectedMessages)
            : current.totalMessages,
      };
        });
      }),
    [],
  );

  const runAction = async (item: UnifiedConversationItem, action: ConversationAction) => {
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

    if (action !== 'delete') {
      const unread = action === 'unread';
      updateUnread(new Map([...previousUnread.keys()].map((messageKey) => [messageKey, unread])));
    }

    try {
      const error = await performConversationAction(
        item.selection.account.id,
        item.selection.folder.path,
        item.conversation,
        action,
      );
      if (error) {
        setActionError(error);
        if (action !== 'delete') updateUnread(previousUnread);
        return false;
      }
      if (action === 'delete') {
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
        setSelectedItem(null);
      }
      return true;
    } catch {
      setActionError('The action could not be completed.');
      if (action !== 'delete') updateUnread(previousUnread);
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

  const runBulkAction = async (action: ConversationAction) => {
    if (bulkBusy) return;
    const groups = new Map<string, BulkMessageJobRequest['groups'][number]>();
    for (const item of selectedItems) {
      const { account, folder } = item.selection;
      const key = `${account.id}:${folder.path}`;
      const group = groups.get(key) ?? { accountId: account.id, folderPath: folder.path, uids: [] };
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
        'Unified inbox',
      );
      if (result.ok) {
        setSelectedItemKeys(new Set());
      } else {
        setActionError(result.message ?? 'The bulk action could not be started.');
      }
    } finally {
      setBulkBusy(false);
    }
  };

  if (selectedItem) {
    return (
      <ConversationReader
        key={`${selectedItem.selection.account.id}:${selectedItem.conversation.id}`}
        selection={selectedItem.selection}
        conversation={selectedItem.conversation}
        onBack={() => setSelectedItem(null)}
        busy={busyConversations.has(itemKey(selectedItem))}
        actionError={actionError}
        onSetUnread={(unread) =>
          void runAction(selectedItem, unread ? 'unread' : 'read')
        }
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
      />
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card py-4 pl-16 pr-4 lg:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Unified inbox</h1>
          <p className="truncate text-xs text-muted-foreground">
            {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state.status === 'loaded' && (
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
            aria-label="Refresh unified inbox"
            title="Refresh unified inbox"
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
            Fetching inboxes
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
          selectedRows={selectedItemKeys.size}
          selectedEmails={selectedEmailCount}
          totalRows={state.items.length}
          busy={bulkBusy}
          permanentDelete={false}
          onToggleAll={() =>
            setSelectedItemKeys(
              selectedItemKeys.size === state.items.length
                ? new Set()
                : new Set(state.items.map((item) => itemKey(item))),
            )
          }
          onClear={() => setSelectedItemKeys(new Set())}
          onAction={(action) => void runBulkAction(action)}
        />
      )}

      {state.status === 'loaded' && state.items.length === 0 && (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Inbox className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">
              {state.failures.length === accounts.length
                ? 'Inboxes could not be loaded'
                : 'Your unified inbox is empty'}
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
            const opponent = conversationOpponent(conversation.messages, selection.account);
            const date = latest.sentAt ?? latest.receivedAt;
            const unread = conversation.messages.some(
              (message) => message.folderPath === selection.folder.path && message.unread,
            );
            const flagged = conversation.messages.some((message) => message.flagged);
            return (
              <div
                key={`${selection.account.id}:${conversation.id}`}
                className={`group flex min-w-0 items-center border-b border-border hover:bg-accent/60 ${selectedItemKeys.has(itemKey(item)) ? 'bg-accent/60' : ''}`}
                role="listitem"
              >
                <div className="pl-4 lg:pl-6" onClick={(event) => event.stopPropagation()}>
                  <SelectionCheckbox
                    checked={selectedItemKeys.has(itemKey(item))}
                    className={cn(
                      'transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                      selectedItemKeys.size > 0 ? 'opacity-100' : 'opacity-0',
                    )}
                    label={`Select conversation: ${conversation.subject}`}
                    onChange={() =>
                      setSelectedItemKeys((current) => {
                        const key = itemKey(item);
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left focus-visible:bg-accent focus-visible:outline-none lg:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] lg:gap-4 lg:px-6"
                  onClick={() => { setActionError(null); setSelectedItem(item); }}
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
                <div className="col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-2 pl-3.5 lg:col-auto lg:row-auto lg:pl-0">
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
                <div className="col-start-2 row-start-1 flex items-center gap-3 text-xs text-muted-foreground lg:col-auto lg:row-auto">
                  {flagged && (
                    <Star className="size-3.5 fill-primary text-primary" aria-label="Flagged" />
                  )}
                  <time dateTime={date ?? undefined}>{messageDate(date)}</time>
                </div>
                </button>
                <div className="pr-3 lg:pr-5">
                  <ConversationActions
                    unread={unread}
                    busy={busyConversations.has(itemKey(item))}
                    confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
                    onSetUnread={(nextUnread) =>
                      void runAction(item, nextUnread ? 'unread' : 'read')
                    }
                    onDelete={() => void runAction(item, 'delete')}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AccountSettingsDialog({
  open,
  accounts,
  onOpenChange,
  onUpdated,
  onRemoved,
}: {
  open: boolean;
  accounts: AccountSummary[];
  onOpenChange: (open: boolean) => void;
  onUpdated: (account: AccountSummary) => void;
  onRemoved: (accountId: string) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const rename = async (account: AccountSummary) => {
    const name = names[account.id]?.trim() ?? '';
    if (!name) {
      setStatus({ kind: 'error', message: 'Enter a name for this account.' });
      return;
    }
    setBusyAccount(account.id);
    setStatus(null);
    try {
      const result = await window.emzero.accounts.update(account.id, { name });
      if (result.ok && result.account) {
        onUpdated(result.account);
        setStatus({ kind: 'success', message: result.message });
      } else {
        setStatus({ kind: 'error', message: result.message });
      }
    } catch {
      setStatus({ kind: 'error', message: 'The account could not be updated.' });
    } finally {
      setBusyAccount(null);
    }
  };

  const remove = async (account: AccountSummary) => {
    setBusyAccount(account.id);
    setStatus(null);
    try {
      const result = await window.emzero.accounts.remove(account.id);
      if (result.ok) {
        onRemoved(account.id);
        setStatus({ kind: 'success', message: `${account.email} was deleted.` });
      } else {
        setStatus({ kind: 'error', message: result.message });
      }
    } catch {
      setStatus({ kind: 'error', message: 'The account could not be deleted.' });
    } finally {
      setBusyAccount(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setNames({});
          setStatus(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>
            Rename connected accounts or remove them from Emzero.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-account text-sm font-semibold text-primary">
                  {account.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                </div>
              </div>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename(account);
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Name for {account.email}</span>
                  <input
                    className="field"
                    value={names[account.id] ?? account.name}
                    disabled={busyAccount === account.id}
                    onChange={(event) =>
                      setNames((current) => ({ ...current, [account.id]: event.target.value }))
                    }
                  />
                </label>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={
                    busyAccount === account.id ||
                    !names[account.id]?.trim() ||
                    names[account.id]?.trim() === account.name
                  }
                >
                  {busyAccount === account.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : null}
                  Save name
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3 text-danger hover:text-danger"
                      aria-label={`Delete ${account.email}`}
                      title="Delete account"
                      disabled={busyAccount === account.id}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {account.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes {account.email} and its locally cached mail from Emzero. It
                        does not delete anything from your mail provider.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void remove(account)}>
                        Delete account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </form>
            </div>
          ))}
        </div>

        {status && (
          <p
            className={cn(
              'flex items-center gap-2 text-sm',
              status.kind === 'success' ? 'text-success' : 'text-danger',
            )}
            role="status"
          >
            {status.kind === 'success' ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <CircleAlert className="size-4" />
            )}
            {status.message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function recipientQuery(value: string): string {
  return value.slice(Math.max(value.lastIndexOf(','), value.lastIndexOf(';')) + 1).trim();
}

function insertRecipient(value: string, suggestion: RecipientSuggestion): string {
  const separator = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
  const prefix = value.slice(0, separator + 1);
  const safeName = suggestion.name && !/[,;]/.test(suggestion.name) ? suggestion.name : null;
  const formatted = safeName ? `${safeName} <${suggestion.address}>` : suggestion.address;
  return `${prefix}${prefix && !/\s$/.test(prefix) ? ' ' : ''}${formatted}, `;
}

function RecipientField({
  label,
  accountId,
  value,
  placeholder,
  disabled,
  autoFocus,
  onChange,
}: {
  label: string;
  accountId: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = recipientQuery(value);

  useEffect(() => {
    if (!focused || !accountId || !query) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void window.emzero.messages
        .suggestRecipients(accountId, query)
        .then((result) => {
          if (active) setSuggestions(result);
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [accountId, focused, query]);

  const choose = (suggestion: RecipientSuggestion) => {
    onChange(insertRecipient(value, suggestion));
    setSuggestions([]);
    setActiveIndex(0);
  };
  const open = focused && query.length > 0 && suggestions.length > 0;

  return (
    <Field label={label}>
      <div className="relative">
        <input
          className="field"
          type="text"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            onChange(event.target.value);
            setSuggestions([]);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % suggestions.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) =>
                current === 0 ? suggestions.length - 1 : current - 1,
              );
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              choose(suggestions[activeIndex]);
            } else if (event.key === 'Escape') {
              setSuggestions([]);
            }
          }}
        />
        {open && (
          <div
            id={listId}
            className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-20 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
            role="listbox"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.address}
                type="button"
                className={cn(
                  'flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-accent',
                  index === activeIndex && 'bg-accent',
                )}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(suggestion)}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-account text-xs font-semibold text-primary">
                  {(suggestion.name || suggestion.address).charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  {suggestion.name && (
                    <span className="block truncate text-sm font-medium">{suggestion.name}</span>
                  )}
                  <span className="block truncate text-xs text-muted-foreground">
                    {suggestion.address}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

function ComposeDialog({
  open,
  accounts,
  defaultAccountId,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  accounts: AccountSummary[];
  defaultAccountId: string | null;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const [accountId, setAccountId] = useState(() =>
    accounts.some((account) => account.id === defaultAccountId)
      ? defaultAccountId!
      : (accounts[0]?.id ?? ''),
  );
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [skipSendConfirmation, setSkipSendConfirmation] = useState(
    storedSkipSendConfirmation,
  );
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<MailSendDraft | null>(null);
  const confirmationActionRef = useRef<HTMLButtonElement>(null);

  const deliver = async (draft: MailSendDraft) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.emzero.messages.send(accountId, draft);
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.message ?? 'Could not send message.' });
        return;
      }
      onSent();
      onOpenChange(false);
    } catch {
      setStatus({ kind: 'error', message: 'Could not send message.' });
    } finally {
      setBusy(false);
    }
  };

  const requestSend = () => {
    const draft: MailSendDraft = {
      to: parseAddressList(to),
      cc: parseAddressList(cc),
      bcc: parseAddressList(bcc),
      subject,
      text: body,
      inReplyTo: null,
      references: [],
    };
    const validationError = validateSendDraft(draft);
    if (validationError) {
      setStatus({ kind: 'error', message: validationError });
      return;
    }
    if (skipSendConfirmation) {
      void deliver(draft);
      return;
    }
    setPendingDraft(draft);
    setDontShowAgain(false);
    setConfirmationOpen(true);
  };

  useSendShortcut(open && !busy && !confirmationOpen, requestSend);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    requestSend();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[min(44rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Send a plain-text email from any connected account.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={submit}
        >
          <Field label="From">
            <div className="relative">
              <select
                className="field appearance-none pr-9"
                value={accountId}
                disabled={busy}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setStatus(null);
                }}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} — {account.email}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
            </div>
          </Field>
          <RecipientField
            label="To"
            accountId={accountId}
            value={to}
            placeholder="Start typing a name or email address"
            autoFocus
            disabled={busy}
            onChange={(value) => {
              setTo(value);
              setStatus(null);
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <RecipientField
              label="Cc"
              accountId={accountId}
              value={cc}
              placeholder="Optional"
              disabled={busy}
              onChange={(value) => {
                setCc(value);
                setStatus(null);
              }}
            />
            <RecipientField
              label="Bcc"
              accountId={accountId}
              value={bcc}
              placeholder="Optional"
              disabled={busy}
              onChange={(value) => {
                setBcc(value);
                setStatus(null);
              }}
            />
          </div>
          <Field label="Subject">
            <input
              className="field"
              value={subject}
              disabled={busy}
              onChange={(event) => {
                setSubject(event.target.value);
                setStatus(null);
              }}
            />
          </Field>
          <Field label="Message">
            <textarea
              className="field min-h-52 resize-y leading-6"
              value={body}
              disabled={busy}
              onChange={(event) => {
                setBody(event.target.value);
                setStatus(null);
              }}
            />
          </Field>
          {status && (
            <p
              className={status.kind === 'success' ? 'text-sm text-success' : 'text-sm text-danger'}
              role="status"
            >
              {status.message}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !accountId}
              title="Send (Ctrl+Enter)"
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send
            </Button>
          </div>
          <p className="text-right text-[0.68rem] text-muted-foreground">
            Send with {sendShortcutLabel()}
          </p>
        </form>
      </DialogContent>
      <AlertDialog
        open={confirmationOpen}
        onOpenChange={(nextOpen) => {
          setConfirmationOpen(nextOpen);
          if (!nextOpen) setPendingDraft(null);
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            confirmationActionRef.current?.focus();
          }}
          onKeyDownCapture={(event) => {
            if (event.key === 'Enter' && !event.repeat) {
              event.preventDefault();
              event.stopPropagation();
              confirmationActionRef.current?.click();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Send this email?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send the message immediately and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDraft && (
            <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
              <p className="truncate">
                <span className="text-muted-foreground">From: </span>
                {accounts.find((account) => account.id === accountId)?.email}
              </p>
              <p className="mt-1 truncate">
                <span className="text-muted-foreground">To: </span>
                {addressDetails(pendingDraft.to)}
              </p>
              <p className="mt-1 truncate">
                <span className="text-muted-foreground">Subject: </span>
                {pendingDraft.subject}
              </p>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              className="size-4 accent-primary"
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
            />
            Don’t show this confirmation again
          </label>
          <p className="text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5">Enter</kbd>{' '}
            to send or <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5">Esc</kbd>{' '}
            to cancel. Open this dialog with {sendShortcutLabel()}.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={confirmationActionRef}
              variant="default"
              onClick={() => {
                if (!pendingDraft) return;
                const draft = pendingDraft;
                if (dontShowAgain) {
                  try {
                    window.localStorage.setItem(skipSendConfirmationStorageKey, 'true');
                  } catch {
                    // Sending should still work if preferences cannot be persisted.
                  }
                  setSkipSendConfirmation(true);
                }
                setPendingDraft(null);
                void deliver(draft);
              }}
            >
              <Send className="size-4" />
              Send email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function Sidebar({
  accounts,
  selection,
  syncStatus,
  syncRevision,
  onSelect,
  onAdd,
  onManage,
  onCompose,
  className,
}: {
  accounts: AccountSummary[];
  selection: MailboxSelection;
  syncStatus: MailSyncStatus;
  syncRevision: number;
  onSelect: (selection: MailboxSelection) => void;
  onAdd: () => void;
  onManage: () => void;
  onCompose: () => void;
  className?: string;
}) {
  const { theme, setTheme, interfaceFont, setInterfaceFont } = useTheme();
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [folderStates, setFolderStates] = useState<Record<string, FolderLoadState>>({});

  const loadFolders = useCallback(
    (accountId: string, onLoaded?: (folders: MailFolderSummary[]) => void) => {
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
    [],
  );

  useEffect(() => {
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
  }, [accounts, syncRevision]);

  useEffect(
    () =>
      window.emzero.messages.onBulkJobProgress((progress) => {
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
      }),
    [],
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
      const folderState = folderStates[account.id];
      if (folderState?.status === 'loaded') selectInbox(folderState.folders);
      else loadFolders(account.id, selectInbox);
    }
  };

  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col overflow-y-auto border-r border-border bg-sidebar p-4',
        className,
      )}
    >
      <div className="mb-8 flex shrink-0 items-center gap-3 px-2">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Mail className="size-4" />
        </div>
        <div>
          <p className="font-semibold tracking-tight">Emzero</p>
          <p className="text-xs text-muted-foreground">Mail</p>
        </div>
      </div>

      <Button
        className="mb-4 w-full shrink-0 justify-start"
        disabled={accounts.length === 0}
        onClick={onCompose}
      >
        <PenLine className="size-4" />
        Compose
      </Button>

      <nav aria-label="Mailboxes" className="shrink-0 space-y-1">
        <Button
          variant={selection.kind === 'unified' ? 'secondary' : 'ghost'}
          className="w-full justify-start"
          onClick={() => onSelect({ kind: 'unified' })}
        >
          <Inbox className="size-4" />
          Unified inbox
        </Button>
        {accounts.length > 0 && (
          <div className="pt-5">
            <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Accounts
            </p>
            {accounts.map((account) => {
              const isExpanded = expanded.has(account.id);
              const folderState = folderStates[account.id];
              const accountUnread =
                folderState?.status === 'loaded'
                  ? accountUnreadCount(folderState.folders)
                  : 0;
              return (
                <div key={account.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 py-2 focus-visible:ring-inset"
                    aria-expanded={isExpanded}
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
                        folderState.folders.map((folder) => {
                          const depth = folder.parentPath
                            ? folder.parentPath.split(folder.delimiter).length
                            : 0;
                          const isSelected =
                            selection.kind === 'folder' &&
                            selection.account.id === account.id &&
                            selection.folder.path === folder.path;
                          return (
                            <Button
                              key={folder.path}
                              variant={isSelected ? 'secondary' : 'ghost'}
                              className="h-7 w-full justify-start gap-1.5 px-2 font-normal"
                              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
                              disabled={!folder.selectable}
                              title={folder.path}
                              onClick={() => onSelect({ kind: 'folder', account, folder })}
                            >
                              <FolderIcon specialUse={folder.specialUse} />
                              <span className="min-w-0 flex-1 truncate text-left text-xs leading-4">
                                {displayFolderName(folder)}
                              </span>
                              <UnreadBadge count={folder.unreadCount ?? 0} />
                            </Button>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      <div className="mt-auto shrink-0 border-t border-border pt-4">
        <label className="relative mb-2 block" aria-label="Color theme">
          <Palette className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <select
            className="preference-select"
            value={theme}
            title="Color theme"
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            {themes.map(({ value, label }) => (
              <option key={value} value={value}>
                {label} theme
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
        </label>
        <label className="relative mb-2 block" aria-label="Interface font">
          <Type className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <select
            className="preference-select"
            value={interfaceFont}
            title="Interface font"
            onChange={(event) => setInterfaceFont(event.target.value as InterfaceFont)}
          >
            {interfaceFonts.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
        </label>
        <Button
          variant="ghost"
          className="mb-1 w-full justify-start text-muted-foreground"
          disabled={syncStatus.state === 'syncing' || accounts.length === 0}
          title={syncStatus.message}
          onClick={() => void window.emzero.sync.now()}
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
          disabled={accounts.length === 0}
          onClick={onManage}
        >
          <Settings2 className="size-4" />
          Manage accounts
        </Button>
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={onAdd}>
          <Plus className="size-4" />
          Add account
        </Button>
      </div>
    </aside>
  );
}

interface BulkOperationView {
  location: string;
  request: BulkMessageJobRequest;
  progress: BulkMessageJobProgress;
  processedKeys: ReadonlySet<string>;
}

function BulkOperationBar({
  operation,
  onStop,
  onRetry,
  onDismiss,
}: {
  operation: BulkOperationView;
  onStop: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { progress, location } = operation;
  const terminal = ['completed', 'stopped', 'error'].includes(progress.state);
  const verb =
    progress.action === 'read'
      ? 'mark as read'
      : progress.action === 'unread'
        ? 'mark as unread'
        : 'delete';
  const presentVerb =
    progress.action === 'read'
      ? 'Marking emails as read'
      : progress.action === 'unread'
        ? 'Marking emails as unread'
        : 'Deleting emails';
  const title =
    progress.state === 'completed'
      ? `${progress.total} ${progress.total === 1 ? 'email' : 'emails'} ${verb === 'delete' ? 'deleted' : progress.action === 'read' ? 'marked as read' : 'marked as unread'}`
      : progress.state === 'stopped'
        ? `Stopped after ${progress.processed} of ${progress.total}`
        : progress.state === 'error'
          ? `Stopped after ${progress.processed} of ${progress.total}`
          : `${presentVerb} in ${location}`;
  const percentage = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 py-3 shadow-[0_-8px_24px_-18px_rgba(0,0,0,0.5)] lg:left-60" aria-live="polite" aria-label="Mail operation status">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
          {progress.state === 'completed' ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : progress.state === 'error' ? (
            <CircleAlert className="size-4 text-danger" />
          ) : progress.state === 'stopped' ? (
            <XCircle className="size-4 text-muted-foreground" />
          ) : progress.action === 'delete' ? (
            <Trash2 className="size-4" />
          ) : progress.action === 'read' ? (
            <MailOpen className="size-4" />
          ) : (
            <Mail className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="truncate font-medium">{title}</p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {progress.processed}/{progress.total}
            </span>
          </div>
          {!terminal && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${percentage}%` }}
              />
            </div>
          )}
          <p className={cn('mt-1 truncate text-xs', progress.state === 'error' ? 'text-danger' : 'text-muted-foreground')}>
            {progress.state === 'running'
              ? 'You can continue using Emzero while this runs.'
              : progress.state === 'stopping'
                ? 'Stopping after the current batch…'
                : progress.message ?? (progress.state === 'stopped' ? 'Completed changes were kept.' : `Finished in ${location}.`)}
          </p>
        </div>
        {progress.state === 'running' && (
          <Button variant="secondary" className="shrink-0" onClick={onStop}>Stop</Button>
        )}
        {progress.state === 'stopping' && (
          <Button variant="secondary" className="shrink-0" disabled>Stopping…</Button>
        )}
        {(progress.state === 'stopped' || progress.state === 'error') && progress.processed < progress.total && (
          <Button variant="secondary" className="shrink-0" onClick={onRetry}>
            {progress.state === 'stopped' ? 'Resume remaining' : 'Retry remaining'}
          </Button>
        )}
        {terminal && (
          <Button variant="ghost" className="size-9 shrink-0 px-0" aria-label="Dismiss operation status" onClick={onDismiss}>
            <XCircle className="size-4" />
          </Button>
        )}
      </div>
    </aside>
  );
}

export function App() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [providers, setProviders] = useState<MailProvider[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selection, setSelection] = useState<MailboxSelection>({ kind: 'unified' });
  const [syncStatus, setSyncStatus] = useState<MailSyncStatus>({
    state: 'idle',
    lastSyncedAt: null,
  });
  const [syncRevision, setSyncRevision] = useState(0);
  const [bulkOperation, setBulkOperation] = useState<BulkOperationView | null>(null);

  useEffect(() => {
    void Promise.allSettled([window.emzero.accounts.list(), window.emzero.providers.list()]).then(
      ([accountsResult, providersResult]) => {
        const loadedAccounts = accountsResult.status === 'fulfilled' ? accountsResult.value : [];
        setAccounts(loadedAccounts);
        setShowSetup(loadedAccounts.length === 0);
        if (providersResult.status === 'fulfilled') setProviders(providersResult.value);
      },
    );
  }, []);

  useEffect(
    () =>
      window.emzero.messages.onBulkJobProgress((progress) => {
        setBulkOperation((current) => {
          if (!current) return current;
          const processedKeys = new Set(current.processedKeys);
          if (progress.accountId && progress.folderPath && progress.processedUids) {
            for (const uid of progress.processedUids) {
              processedKeys.add(`${progress.accountId}:${progress.folderPath}:${uid}`);
            }
          }
          return { ...current, progress, processedKeys };
        });
        if (['completed', 'stopped', 'error'].includes(progress.state)) {
          setSyncRevision((current) => current + 1);
        }
      }),
    [],
  );

  useEffect(() => {
    if (bulkOperation?.progress.state !== 'completed') return;
    const timer = window.setTimeout(() => setBulkOperation(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [bulkOperation?.progress.state]);

  const startBulkOperation = useCallback<StartBulkOperation>(async (request, location) => {
    if (
      bulkOperation?.progress.state === 'running' ||
      bulkOperation?.progress.state === 'stopping'
    ) {
      return { ok: false, message: 'Another bulk message action is already running.' };
    }
    const total = request.groups.reduce((sum, group) => sum + group.uids.length, 0);
    setBulkOperation({
      location,
      request,
      processedKeys: new Set(),
      progress: {
        jobId: 'starting',
        action: request.action,
        state: 'running',
        total,
        processed: 0,
      },
    });
    try {
      const result = await window.emzero.messages.startBulkJob(request);
      if (!result.ok || !result.jobId) {
        setBulkOperation(null);
        return result;
      }
      setBulkOperation((current) =>
        current
          ? { ...current, progress: { ...current.progress, jobId: result.jobId! } }
          : current,
      );
      return result;
    } catch {
      setBulkOperation(null);
      return { ok: false, message: 'The bulk action could not be started.' };
    }
  }, [bulkOperation?.progress.state]);

  useEffect(() => {
    void window.emzero.sync.status().then(setSyncStatus).catch(() => undefined);
    return window.emzero.sync.onStatus((status) => {
      setSyncStatus(status);
      if (status.state !== 'syncing') setSyncRevision((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    const desktopLayout = window.matchMedia('(min-width: 64rem)');
    const closeCompactSidebar = (event: MediaQueryListEvent) => {
      if (event.matches) setSidebarOpen(false);
    };
    desktopLayout.addEventListener('change', closeCompactSidebar);
    return () => desktopLayout.removeEventListener('change', closeCompactSidebar);
  }, []);

  if (accounts === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading accounts" />
      </main>
    );
  }

  return (
    <main className="grid h-screen grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Sidebar
        className="hidden lg:flex"
        accounts={accounts}
        selection={selection}
        syncStatus={syncStatus}
        syncRevision={syncRevision}
        onSelect={(nextSelection) => {
          setSelection(nextSelection);
          setShowSetup(false);
        }}
        onAdd={() => setShowSetup(true)}
        onManage={() => setSettingsOpen(true)}
        onCompose={() => setComposeOpen(true)}
      />
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetTrigger asChild>
          <Button
            variant="secondary"
            className="fixed left-3 top-3 z-40 size-10 border border-border bg-card px-0 shadow-sm lg:hidden"
            aria-label="Open navigation"
            title="Open navigation"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent className="p-0 lg:hidden">
          <div className="sr-only">
            <SheetTitle>Mail navigation</SheetTitle>
            <SheetDescription>Choose an inbox, folder, or account action.</SheetDescription>
          </div>
          <Sidebar
            className="h-full border-r-0"
            accounts={accounts}
            selection={selection}
            syncStatus={syncStatus}
            syncRevision={syncRevision}
            onSelect={(nextSelection) => {
              setSelection(nextSelection);
              setShowSetup(false);
              setSidebarOpen(false);
            }}
            onAdd={() => {
              setShowSetup(true);
              setSidebarOpen(false);
            }}
            onManage={() => {
              setSettingsOpen(true);
              setSidebarOpen(false);
            }}
            onCompose={() => {
              setComposeOpen(true);
              setSidebarOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
      {composeOpen && (
        <ComposeDialog
          open
          accounts={accounts}
          defaultAccountId={
            selection.kind === 'folder' ? selection.account.id : (accounts[0]?.id ?? null)
          }
          onOpenChange={setComposeOpen}
          onSent={() => setSyncRevision((current) => current + 1)}
        />
      )}
      <AccountSettingsDialog
        open={settingsOpen}
        accounts={accounts}
        onOpenChange={setSettingsOpen}
        onUpdated={(updatedAccount) => {
          setAccounts((current) =>
            current?.map((account) =>
              account.id === updatedAccount.id ? updatedAccount : account,
            ) ?? [],
          );
          setSelection((current) =>
            current.kind === 'folder' && current.account.id === updatedAccount.id
              ? { ...current, account: updatedAccount }
              : current,
          );
        }}
        onRemoved={(accountId) => {
          const remainingAccounts = accounts.filter((account) => account.id !== accountId);
          setAccounts(remainingAccounts);
          setSelection((current) =>
            current.kind === 'folder' && current.account.id === accountId
              ? { kind: 'unified' }
              : current,
          );
          if (remainingAccounts.length === 0) {
            setSettingsOpen(false);
            setShowSetup(true);
          }
        }}
      />
      {showSetup ? (
        <AccountSetup
          providers={providers}
          canCancel={accounts.length > 0}
          onCancel={() => setShowSetup(false)}
          onSaved={(account) => {
            setAccounts((current) => [...(current ?? []), account]);
            setShowSetup(false);
          }}
        />
      ) : selection.kind === 'folder' ? (
        <MessageList
          key={`${selection.account.id}:${selection.folder.path}:${syncRevision}`}
          selection={selection}
          onStartBulkOperation={startBulkOperation}
        />
      ) : (
        <UnifiedInbox
          key={syncRevision}
          accounts={accounts}
          onStartBulkOperation={startBulkOperation}
        />
      )}
      {bulkOperation && (
        <BulkOperationBar
          operation={bulkOperation}
          onStop={() => {
            void window.emzero.messages.cancelBulkJob(bulkOperation.progress.jobId);
          }}
          onRetry={() => {
            const request: BulkMessageJobRequest = {
              ...bulkOperation.request,
              groups: bulkOperation.request.groups
                .map((group) => ({
                  ...group,
                  uids: group.uids.filter(
                    (uid) =>
                      !bulkOperation.processedKeys.has(
                        `${group.accountId}:${group.folderPath}:${uid}`,
                      ),
                  ),
                }))
                .filter((group) => group.uids.length > 0),
            };
            void startBulkOperation(request, bulkOperation.location);
          }}
          onDismiss={() => setBulkOperation(null)}
        />
      )}
    </main>
  );
}
