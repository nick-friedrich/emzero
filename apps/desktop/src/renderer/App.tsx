import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Archive,
  ArrowLeft,
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
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  Server,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  AccountDraft,
  AccountSummary,
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSummary,
  MailProvider,
} from '../shared/accounts';

const initialDraft: AccountDraft = {
  name: 'Personal',
  email: '',
  username: '',
  password: '',
  imap: { host: '', port: 993, secure: true },
  smtp: { host: '', port: 465, secure: true },
};

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
    <section className="overflow-y-auto bg-background p-8 lg:p-12">
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
            <Field label="Account name">
              <input
                className="field"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                autoComplete="off"
              />
            </Field>
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
      return <Inbox className="size-3.5" />;
    case '\\Sent':
      return <Send className="size-3.5" />;
    case '\\Drafts':
      return <FileText className="size-3.5" />;
    case '\\Archive':
      return <Archive className="size-3.5" />;
    case '\\Trash':
    case '\\Junk':
      return <Trash2 className="size-3.5" />;
    default:
      return <Folder className="size-3.5" />;
  }
}

function addressLabel(addresses: MailMessageSummary['from']): string {
  if (addresses.length === 0) return 'Unknown sender';
  return addresses
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

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function htmlDocument(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>html{color-scheme:light}body{box-sizing:border-box;margin:0;padding:1.5rem;color:#292524;background:#fff;font:14px/1.65 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${body}</body></html>`;
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
  | { status: 'loaded'; messages: MailMessageSummary[]; total: number }
  | { status: 'error'; message: string };

type MessageDetailLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; message: MailMessageDetail }
  | { status: 'error'; message: string };

function MessageReader({
  selection,
  summary,
  onBack,
}: {
  selection: FolderSelection;
  summary: MailMessageSummary;
  onBack: () => void;
}) {
  const [state, setState] = useState<MessageDetailLoadState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<'html' | 'text'>('html');

  useEffect(() => {
    let active = true;
    void window.emzero.messages
      .get(selection.account.id, selection.folder.path, summary.uid)
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
  }, [refreshKey, selection.account.id, selection.folder.path, summary.uid]);

  const retry = () => {
    setState({ status: 'loading' });
    setRefreshKey((current) => current + 1);
  };

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Button variant="ghost" className="px-3" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <span className="truncate text-sm text-muted-foreground">
          {selection.account.name} / {selection.folder.name}
        </span>
      </header>

      {state.status === 'loading' && (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" />
            Loading message
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="grid flex-1 place-items-center p-8">
          <div className="max-w-md text-center">
            <CircleAlert className="mx-auto size-8 text-danger" />
            <h2 className="mt-3 font-semibold">Message could not be loaded</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{state.message}</p>
            <Button className="mt-5" variant="secondary" onClick={retry}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </div>
        </div>
      )}

      {state.status === 'loaded' && (
        <article className="min-h-0 flex-1 overflow-y-auto px-8 py-7 lg:px-12">
          <div className="mx-auto max-w-4xl">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              {state.message.subject}
            </h1>
            <div className="mt-5 flex items-start justify-between gap-6 border-b border-border pb-5">
              <div className="min-w-0 text-sm leading-6">
                <p className="truncate font-medium">{addressDetails(state.message.from)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  To: {addressDetails(state.message.to)}
                </p>
                {state.message.cc.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    Cc: {addressDetails(state.message.cc)}
                  </p>
                )}
              </div>
              <time
                className="shrink-0 text-xs text-muted-foreground"
                dateTime={state.message.sentAt ?? undefined}
              >
                {messageDate(state.message.sentAt)}
              </time>
            </div>

            {state.message.html && (
              <div className="mt-4 flex justify-end gap-1" aria-label="Message format">
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

            {state.message.html && view === 'html' ? (
              <iframe
                className="mt-4 h-[60vh] min-h-96 w-full rounded-md border border-border bg-white"
                title="Email content"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={htmlDocument(state.message.html)}
              />
            ) : (
              <div className="mt-7 whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
                {state.message.text}
              </div>
            )}

            {state.message.attachments.some(({ related }) => !related) && (
              <section className="mt-8 border-t border-border pt-5" aria-label="Attachments">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Paperclip className="size-4" />
                  Attachments
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {state.message.attachments
                    .filter(({ related }) => !related)
                    .map((attachment, index) => (
                      <div
                        key={`${attachment.filename}:${index}`}
                        className="rounded-md border border-border bg-card px-3 py-2 text-xs"
                      >
                        <span className="font-medium">{attachment.filename}</span>
                        <span className="ml-2 text-muted-foreground">
                          {fileSize(attachment.size)}
                        </span>
                      </div>
                    ))}
                </div>
              </section>
            )}
          </div>
        </article>
      )}
    </section>
  );
}

function MessageList({ selection }: { selection: FolderSelection }) {
  const [state, setState] = useState<MessageLoadState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState<MailMessageSummary | null>(null);

  useEffect(() => {
    let active = true;
    void window.emzero.messages
      .list(selection.account.id, selection.folder.path)
      .then((result) => {
        if (!active) return;
        setState(
          result.ok
            ? { status: 'loaded', messages: result.messages, total: result.total }
            : { status: 'error', message: result.message ?? 'Could not load messages.' },
        );
      })
      .catch(() => {
        if (active) setState({ status: 'error', message: 'Could not load messages.' });
      });
    return () => {
      active = false;
    };
  }, [refreshKey, selection.account.id, selection.folder.path]);

  const refresh = () => {
    setState({ status: 'loading' });
    setRefreshKey((current) => current + 1);
  };

  const showRecipients = selection.folder.specialUse === '\\Sent';

  if (selectedMessage) {
    return (
      <MessageReader
        key={selectedMessage.uid}
        selection={selection}
        summary={selectedMessage}
        onBack={() => setSelectedMessage(null)}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{selection.folder.name}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {selection.account.name} · {selection.account.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state.status === 'loaded' && (
            <span className="text-xs text-muted-foreground">
              {state.messages.length < state.total
                ? `Newest ${state.messages.length} of ${state.total}`
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

      {state.status === 'loaded' && state.messages.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Messages">
          {state.messages.map((message) => {
            const people = showRecipients ? message.to : message.from;
            const date = message.sentAt ?? message.receivedAt;
            return (
              <button
                type="button"
                key={message.uid}
                className="grid w-full grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] items-center gap-4 border-b border-border px-6 py-3 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
                role="listitem"
                onClick={() => setSelectedMessage(message)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${message.unread ? 'bg-primary' : 'bg-transparent'}`}
                    aria-label={message.unread ? 'Unread' : 'Read'}
                  />
                  <span className={`truncate text-sm ${message.unread ? 'font-semibold' : ''}`}>
                    {showRecipients ? `To: ${addressLabel(people)}` : addressLabel(people)}
                  </span>
                </div>
                <p className={`truncate text-sm ${message.unread ? 'font-semibold' : ''}`}>
                  {message.subject}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {message.flagged && (
                    <Star className="size-3.5 fill-primary text-primary" aria-label="Flagged" />
                  )}
                  <time dateTime={date ?? undefined}>{messageDate(date)}</time>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Sidebar({
  accounts,
  selection,
  onSelect,
  onAdd,
}: {
  accounts: AccountSummary[];
  selection: MailboxSelection;
  onSelect: (selection: MailboxSelection) => void;
  onAdd: () => void;
}) {
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [folderStates, setFolderStates] = useState<Record<string, FolderLoadState>>({});

  const loadFolders = useCallback((accountId: string) => {
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
      })
      .catch(() => {
        setFolderStates((current) => ({
          ...current,
          [accountId]: { status: 'error', message: 'Could not load folders.' },
        }));
      });
  }, []);

  const toggleAccount = (accountId: string) => {
    const isOpening = !expanded.has(accountId);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
    if (isOpening && !folderStates[accountId]) loadFolders(accountId);
  };

  return (
    <aside className="flex flex-col border-r border-border bg-sidebar p-4">
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Mail className="size-4" />
        </div>
        <div>
          <p className="font-semibold tracking-tight">Emzero</p>
          <p className="text-xs text-muted-foreground">Private mail</p>
        </div>
      </div>

      <Button className="mb-6 w-full justify-start" size="lg" disabled={accounts.length === 0}>
        <PenLine className="size-4" />
        Compose
      </Button>

      <nav aria-label="Mailboxes" className="space-y-1">
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
              return (
                <div key={account.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 py-2"
                    aria-expanded={isExpanded}
                    onClick={() => toggleAccount(account.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-account text-xs font-semibold text-primary">
                      {account.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm">{account.name}</span>
                      <span className="block truncate text-[0.68rem] font-normal text-muted-foreground">
                        {account.email}
                      </span>
                    </span>
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
                              className="h-8 w-full justify-start px-2 text-xs font-normal"
                              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
                              disabled={!folder.selectable}
                              title={folder.path}
                              onClick={() => onSelect({ kind: 'folder', account, folder })}
                            >
                              <FolderIcon specialUse={folder.specialUse} />
                              <span className="truncate">{folder.name}</span>
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

      <div className="mt-auto border-t border-border pt-4">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={onAdd}>
          <Plus className="size-4" />
          Add account
        </Button>
      </div>
    </aside>
  );
}

export function App() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [providers, setProviders] = useState<MailProvider[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [selection, setSelection] = useState<MailboxSelection>({ kind: 'unified' });

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

  if (accounts === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading accounts" />
      </main>
    );
  }

  return (
    <main className="grid h-screen grid-cols-[15rem_1fr] overflow-hidden bg-background text-foreground">
      <Sidebar
        accounts={accounts}
        selection={selection}
        onSelect={(nextSelection) => {
          setSelection(nextSelection);
          setShowSetup(false);
        }}
        onAdd={() => setShowSetup(true)}
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
          key={`${selection.account.id}:${selection.folder.path}`}
          selection={selection}
        />
      ) : (
        <section className="grid place-items-center p-8">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl border border-border bg-card shadow-sm">
              <Inbox className="size-7 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Unified inbox</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose an account folder to fetch its newest messages. Unified cached mail is coming
              with offline sync.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Desktop shell running on {window.emzero.platform}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
