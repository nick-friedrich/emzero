import { useEffect, useState, type FormEvent } from 'react';
import {
  Bell,
  CircleAlert,
  Landmark,
  LoaderCircle,
  MinusCircle,
  Newspaper,
  Pencil,
  Plane,
  Plus,
  Receipt,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { MailMessageSummary } from '../../shared/accounts';
import type { MailConversation } from '../../shared/conversations';
import {
  MAX_SMART_INBOX_NAME_LENGTH,
  MAX_SMART_INBOX_RULE_LENGTH,
  messageInsightTags,
  SMART_INBOX_TEMPLATES,
  type MailInsightsStatus,
  type MessageInsightTag,
  type SmartInbox,
  type SmartInboxDraft,
  type SmartInboxSettings,
  type SmartInboxTemplate,
} from '../../shared/mail-insights';
import { UnreadBadge } from './mail-common';

const privacyNotice =
  'Emzero sends the sender, subject, and a short text preview of your newest Inbox mail to OpenRouter, which forwards them to TypeSafe’s Jev model for classification. Results are stored only on this device.';

export interface SmartInboxState {
  loaded: boolean;
  settings: SmartInboxSettings;
  status: MailInsightsStatus;
}

export function useSmartInboxes(disabled = false): SmartInboxState {
  const [state, setState] = useState<SmartInboxState>({
    loaded: disabled,
    settings: { enabled: false, inboxes: [] },
    status: { state: 'idle' },
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (disabled) return;
    return window.emzero.smartInboxes.onChanged(() => setRevision((current) => current + 1));
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;
    let active = true;
    void Promise.all([
      window.emzero.smartInboxes.getSettings(),
      window.emzero.smartInboxes.status(),
    ])
      .then(([settings, status]) => {
        if (active) setState({ loaded: true, settings, status });
      })
      .catch(() => {
        if (active) setState((current) => ({ ...current, loaded: true }));
      });
    return () => {
      active = false;
    };
  }, [disabled, revision]);

  return state;
}

/** Latest Inbox message of a conversation, the one whose classification is shown. */
export function conversationInsightMessage(
  conversation: MailConversation,
  folderPath: string,
): MailMessageSummary | undefined {
  return conversation.messages.find(
    (message) => message.folderPath === folderPath && message.insights,
  );
}

const tagClasses: Record<MessageInsightTag['kind'], string> = {
  urgent: 'bg-danger/10 text-danger',
  'needs-reply': 'bg-primary/10 text-primary',
  category: 'bg-secondary text-secondary-foreground',
};

export function MessageInsightTags({
  message,
  className,
}: {
  message: MailMessageSummary | undefined;
  className?: string;
}) {
  const tags = messageInsightTags(message?.insights);
  if (tags.length === 0) return null;
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {tags.map((tag) => (
        <span
          key={tag.kind}
          className={cn('rounded px-1.5 py-0.5 text-[0.65rem] font-medium', tagClasses[tag.kind])}
        >
          {tag.label}
        </span>
      ))}
    </span>
  );
}

const templateIcons: Record<SmartInboxTemplate['icon'], typeof Newspaper> = {
  newspaper: Newspaper,
  receipt: Receipt,
  plane: Plane,
  landmark: Landmark,
  bell: Bell,
};

function SmartInboxIcon({ inbox, className }: { inbox: SmartInbox; className?: string }) {
  const template = SMART_INBOX_TEMPLATES.find((candidate) => candidate.name === inbox.name);
  const Icon = template ? templateIcons[template.icon] : Sparkles;
  return <Icon className={className} />;
}

export function SmartInboxNav({
  selectedInboxId,
  syncRevision,
  onSelect,
  onDeleted,
}: {
  selectedInboxId: string | null;
  syncRevision: number;
  onSelect: (inboxId: string) => void;
  onDeleted: (inboxId: string) => void;
}) {
  const { loaded, settings, status } = useSmartInboxes();
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [editor, setEditor] = useState<SmartInbox | 'new' | null>(null);

  useEffect(() => {
    if (!settings.enabled || settings.inboxes.length === 0) return;
    let active = true;
    void window.emzero.smartInboxes.unreadCounts()
      .then((counts) => {
        if (active) setUnreadCounts(counts);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [settings, syncRevision]);

  if (!loaded) return null;
  const inboxes = settings.enabled ? settings.inboxes : [];

  return (
    <div className="pt-5">
      <div className="mb-2 flex items-center justify-between px-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Smart inboxes
        </p>
        <span className="flex items-center gap-1">
          {status.state === 'running' && (
            <LoaderCircle className="size-3 animate-spin text-muted-foreground" aria-label="Sorting new mail" />
          )}
          {status.state === 'error' && (
            <CircleAlert className="size-3.5 text-danger" aria-label={status.message} />
          )}
          <button
            type="button"
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="New smart inbox"
            title="New smart inbox"
            onClick={() => setEditor('new')}
          >
            <Plus className="size-3.5" />
          </button>
        </span>
      </div>
      {status.state === 'error' && status.message && (
        <p className="mb-2 px-3 text-[0.68rem] leading-4 text-danger">{status.message}</p>
      )}
      {inboxes.length === 0 ? (
        <button
          type="button"
          className="w-full rounded-md px-3 py-2 text-left text-xs leading-5 text-muted-foreground hover:bg-accent/60"
          onClick={() => setEditor('new')}
        >
          Let AI sort newsletters, receipts, and more into their own inboxes.
        </button>
      ) : (
        <nav aria-label="Smart inboxes" className="space-y-1">
          {inboxes.map((inbox) => (
            <div key={inbox.id} className="group relative">
              <Button
                variant={selectedInboxId === inbox.id ? 'secondary' : 'ghost'}
                className="w-full shrink-0 justify-start pr-9"
                onClick={() => onSelect(inbox.id)}
              >
                <SmartInboxIcon inbox={inbox} className="size-4" />
                <span className="truncate">{inbox.name}</span>
                <UnreadBadge count={unreadCounts[inbox.id] ?? 0} />
              </Button>
              <button
                type="button"
                className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md bg-card text-muted-foreground opacity-0 shadow-sm hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Edit ${inbox.name}`}
                title={`Edit ${inbox.name}`}
                onClick={() => setEditor(inbox)}
              >
                <Pencil className="size-3" />
              </button>
            </div>
          ))}
        </nav>
      )}
      <SmartInboxDialog
        key={editor === null ? 'closed' : editor === 'new' ? 'new' : editor.id}
        open={editor !== null}
        inbox={editor === 'new' ? null : editor}
        enabled={settings.enabled}
        existingNames={settings.inboxes.map(({ name }) => name)}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        onSaved={(inboxId) => {
          setEditor(null);
          onSelect(inboxId);
        }}
        onDeleted={(inboxId) => {
          setEditor(null);
          onDeleted(inboxId);
        }}
      />
    </div>
  );
}

function SmartInboxDialog({
  open,
  inbox,
  enabled,
  existingNames,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  inbox: SmartInbox | null;
  enabled: boolean;
  existingNames: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: (inboxId: string) => void;
  onDeleted: (inboxId: string) => void;
}) {
  const [draft, setDraft] = useState<SmartInboxDraft>(() =>
    inbox
      ? { name: inbox.name, rule: inbox.rule, skipInbox: inbox.skipInbox }
      : { name: '', rule: '', skipInbox: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templates = SMART_INBOX_TEMPLATES.filter(
    (template) => !existingNames.includes(template.name),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = inbox
        ? await window.emzero.smartInboxes.update(inbox.id, draft)
        : await window.emzero.smartInboxes.create(draft);
      if (!result.ok || !result.settings) {
        setError(result.message ?? 'Could not save the smart inbox.');
        return;
      }
      const saved = inbox ?? result.settings.inboxes.at(-1);
      if (saved) onSaved(saved.id);
    } catch {
      setError('Could not save the smart inbox.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!inbox) return;
    setBusy(true);
    try {
      const result = await window.emzero.smartInboxes.remove(inbox.id);
      if (result.ok) onDeleted(inbox.id);
      else setError(result.message ?? 'Could not delete the smart inbox.');
    } catch {
      setError('Could not delete the smart inbox.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{inbox ? `Edit ${inbox.name}` : 'New smart inbox'}</DialogTitle>
          <DialogDescription>
            Describe the mail that belongs here in plain words. AI sorts new Inbox mail into it;
            nothing is moved on your mail server.
          </DialogDescription>
        </DialogHeader>
        {!inbox && templates.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Templates">
            {templates.map((template) => {
              const Icon = templateIcons[template.icon];
              return (
                <button
                  key={template.name}
                  type="button"
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-accent',
                    draft.name === template.name && 'border-primary bg-primary/10 text-primary',
                  )}
                  onClick={() => setDraft({
                    name: template.name,
                    rule: template.rule,
                    skipInbox: template.skipInbox,
                  })}
                >
                  <Icon className="size-3.5" />
                  {template.name}
                </button>
              );
            })}
          </div>
        )}
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block space-y-1.5 text-xs font-medium">
            <span>Name</span>
            <input
              className="field"
              value={draft.name}
              maxLength={MAX_SMART_INBOX_NAME_LENGTH}
              placeholder="Newsletters"
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="block space-y-1.5 text-xs font-medium">
            <span>Which mail belongs here?</span>
            <textarea
              className="field min-h-20 resize-y"
              value={draft.rule}
              maxLength={MAX_SMART_INBOX_RULE_LENGTH}
              placeholder="Newsletters, digests, and marketing mail"
              onChange={(event) => setDraft((current) => ({ ...current, rule: event.target.value }))}
            />
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.skipInbox}
              onChange={(event) => setDraft((current) => ({ ...current, skipInbox: event.target.checked }))}
            />
            <span>
              <span className="block text-sm font-medium">Hide matches from Inbox</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                Matching mail only appears here, not in the combined Inbox. Account inbox folders
                still show everything.
              </span>
            </span>
          </label>
          {!enabled && (
            <p className="rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
              Creating a smart inbox turns on AI sorting. {privacyNotice} Requires OpenRouter as
              the AI provider in Settings.
            </p>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            {inbox ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : <span />}
            <Button type="submit" disabled={busy || !draft.name.trim() || !draft.rule.trim()}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {inbox ? 'Save' : 'Create smart inbox'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveFromSmartInboxButton({
  inbox,
  sender,
}: {
  inbox: SmartInbox;
  sender: string | null;
}) {
  const [busy, setBusy] = useState(false);
  if (!sender) return null;
  const label = `Never put mail from ${sender} in ${inbox.name}`;
  return (
    <Button
      variant="ghost"
      className="size-8 px-0"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void window.emzero.smartInboxes.excludeSender(inbox.id, sender)
          .finally(() => setBusy(false));
      }}
    >
      <MinusCircle className="size-4" />
    </Button>
  );
}

export function SmartInboxSettingsSection() {
  const { loaded, settings, status } = useSmartInboxes();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!loaded) return null;

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.emzero.smartInboxes.setEnabled(enabled);
      if (!result.ok) setError(result.message ?? 'Could not change the setting.');
    } catch {
      setError('Could not change the setting.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <Sparkles className="size-5 text-muted-foreground" />
        <h3 className="text-sm font-medium">Smart inboxes and tags</h3>
      </div>
      <label className="flex cursor-pointer items-start gap-3 py-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) => void setEnabled(event.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">Sort and tag new mail with AI</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {privacyNotice} Turning this off deletes all stored classifications. Uses the
            OpenRouter key above; costs about $0.03 per 1,000 emails.
          </span>
        </span>
      </label>
      {settings.enabled && status.state === 'error' && status.message && (
        <p className="text-sm text-danger">{status.message}</p>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </section>
  );
}
