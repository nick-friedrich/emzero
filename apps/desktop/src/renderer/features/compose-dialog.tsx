import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ChevronDown,
  LoaderCircle,
  Send,
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
  type MailSendDraft,
  type MailOutgoingAttachment,
  type RecipientSuggestion,
} from '../../shared/accounts';
import {
  parseAddressList,
  validateSendDraft,
} from '../../shared/replies';
import { sendShortcutLabel, skipSendConfirmationStorageKey, storedSkipSendConfirmation, useSendShortcut, type Status } from './app-shared';
import { Field } from './form-field';
import { addressDetails } from './mail-common';
import { AttachmentPicker } from './attachment-picker';

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

export function ComposeDialog({
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
  const [attachments, setAttachments] = useState<MailOutgoingAttachment[]>([]);
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
      setAttachments([]);
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
      attachments,
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
          <DialogDescription>Send an email with optional attachments from any connected account.</DialogDescription>
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
          <AttachmentPicker
            attachments={attachments}
            disabled={busy}
            onChange={(nextAttachments) => {
              setAttachments(nextAttachments);
              setStatus(null);
            }}
            onError={(message) => setStatus({ kind: 'error', message })}
          />
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
              {pendingDraft.attachments.length > 0 && (
                <p className="mt-1 truncate">
                  <span className="text-muted-foreground">Attachments: </span>
                  {pendingDraft.attachments.length}
                </p>
              )}
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
