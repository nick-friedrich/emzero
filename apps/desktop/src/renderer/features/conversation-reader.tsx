import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Paperclip,
  Reply,
  RefreshCw,
  Send,
  Trash2,
  X,
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
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme';
import type {
  AccountSummary,
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSummary,
  MailOutgoingAttachment,
  MailSendDraft,
  MessageMoveDestination,
} from '../../shared/accounts';
import { displayFolderName } from '../../shared/accounts';
import {
  splitQuotedText,
  type MailConversation,
} from '../../shared/conversations';
import {
  createReplyDraft,
  replyRecipients,
  validateReplyDraft,
} from '../../shared/replies';
import {
  sendShortcutLabel,
  skipSendConfirmationStorageKey,
  storedSkipSendConfirmation,
  useSendShortcut,
  type Status,
} from './app-shared';
import {
  ConversationActions,
  addressLabel,
  addressDetails,
  fileSize,
  hasRemoteImages,
  htmlDocument,
  isEditableTarget,
  messageCountInFolder,
  messageDate,
  type FolderSelection,
  type MessageDetailLoadState,
} from './mail-common';
import { AttachmentPicker } from './attachment-picker';
import { useDraftAutosave } from './draft-autosave';
import { ComposeDialog, type DraftSavedEvent } from './compose-dialog';
import { signatureBody } from './signatures';

function MessageBody({
  accountId,
  folderPath,
  message,
  demo = false,
}: {
  accountId: string;
  folderPath: string;
  message: MailMessageDetail;
  demo?: boolean;
}) {
  const { theme, alwaysLoadRemoteImages } = useTheme();
  const [view, setView] = useState<'html' | 'text'>('html');
  const [showQuoted, setShowQuoted] = useState(false);
  const [remoteImagesLoadedFor, setRemoteImagesLoadedFor] = useState<string | null>(null);
  const [attachmentAction, setAttachmentAction] = useState<{ index: number; kind: 'open' | 'save' } | null>(null);
  const [attachmentStatus, setAttachmentStatus] = useState<Status | null>(null);
  const [savedAttachmentId, setSavedAttachmentId] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const messageFrameRef = useRef<HTMLIFrameElement>(null);
  const textParts = splitQuotedText(message.text);
  const hasQuotedText = view === 'html' ? message.htmlHasQuotedText : Boolean(textParts.quoted);
  const messageKey = `${accountId}\0${folderPath}\0${message.uid}`;
  const loadRemoteImages = alwaysLoadRemoteImages || remoteImagesLoadedFor === messageKey;
  const remoteImagesBlocked = Boolean(message.html && hasRemoteImages(message.html) && !loadRemoteImages);

  useEffect(() => {
    const receiveLink = (event: MessageEvent<unknown>) => {
      if (event.source !== messageFrameRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as { type?: unknown; url?: unknown };
      if (data.type !== 'emzero:open-link' || typeof data.url !== 'string') return;
      try {
        const url = new URL(data.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') setPendingLink(url.toString());
      } catch {
        // Ignore malformed or relative links that cannot be opened safely.
      }
    };
    window.addEventListener('message', receiveLink);
    return () => window.removeEventListener('message', receiveLink);
  }, []);

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
        <>
          {remoteImagesBlocked && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span>Remote images are hidden to protect your privacy.</span>
              <Button
                variant="secondary"
                className="h-7 shrink-0 px-2.5 text-xs"
                onClick={() => setRemoteImagesLoadedFor(messageKey)}
              >
                Load images
              </Button>
            </div>
          )}
          <iframe
            ref={messageFrameRef}
            className="mt-3 h-[55vh] min-h-80 w-full rounded-md border border-border bg-white"
            title="Email content"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={htmlDocument(message.html, showQuoted, theme, loadRemoteImages)}
          />
        </>
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

      <AlertDialog open={pendingLink !== null} onOpenChange={(open) => { if (!open) setPendingLink(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open this link?</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              This link will open in your default browser: {pendingLink}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingLink) void window.emzero.openExternalLink(pendingLink);
                setPendingLink(null);
              }}
            >
              Open link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {message.attachments.some(({ related }) => !related) && (
        <section className="mt-6 border-t border-border pt-5" aria-label="Attachments">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="size-4" />
            Attachments
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments
              .map((attachment, index) => ({ attachment, index }))
              .filter(({ attachment }) => !attachment.related)
              .map(({ attachment, index }) => (
                <div
                  key={`${attachment.filename}:${index}`}
                  className="flex overflow-hidden rounded-md border border-border bg-background text-xs"
                >
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-2 text-left hover:bg-accent disabled:opacity-60"
                    disabled={attachmentAction !== null || demo}
                    title={`Open ${attachment.filename}`}
                    onClick={() => {
                      setAttachmentAction({ index, kind: 'open' });
                      setAttachmentStatus(null);
                      setSavedAttachmentId(null);
                      void window.emzero.messages
                        .openAttachment(accountId, folderPath, message.uid, index)
                        .then((result) =>
                          setAttachmentStatus({
                            kind: result.ok ? 'success' : 'error',
                            message:
                              result.message ??
                              (result.ok ? 'Attachment opened.' : 'Could not open attachment.'),
                          }),
                        )
                        .catch(() =>
                          setAttachmentStatus({
                            kind: 'error',
                            message: 'Could not open attachment.',
                          }),
                        )
                        .finally(() => setAttachmentAction(null));
                    }}
                  >
                    {attachmentAction?.index === index && attachmentAction.kind === 'open' ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="size-3.5" />
                    )}
                    <span className="font-medium">{attachment.filename}</span>
                    <span className="text-muted-foreground">{fileSize(attachment.size)}</span>
                  </button>
                  <button
                    type="button"
                    className="border-l border-border px-2.5 hover:bg-accent disabled:opacity-60"
                    disabled={attachmentAction !== null || demo}
                    aria-label={`Save ${attachment.filename}`}
                    title={`Save ${attachment.filename}`}
                    onClick={() => {
                      if (demo) return;
                      setAttachmentAction({ index, kind: 'save' });
                      setAttachmentStatus(null);
                      setSavedAttachmentId(null);
                      void window.emzero.messages
                        .saveAttachment(accountId, folderPath, message.uid, index)
                        .then((result) => {
                          if (!result.canceled) {
                            setAttachmentStatus({
                              kind: result.ok ? 'success' : 'error',
                              message:
                                result.message ??
                                (result.ok ? 'Attachment saved.' : 'Could not save attachment.'),
                            });
                            setSavedAttachmentId(result.savedAttachmentId ?? null);
                          }
                        })
                        .catch(() =>
                          setAttachmentStatus({
                            kind: 'error',
                            message: 'Could not save attachment.',
                          }),
                        )
                        .finally(() => setAttachmentAction(null));
                    }}
                  >
                    {attachmentAction?.index === index && attachmentAction.kind === 'save' ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                  </button>
                </div>
              ))}
          </div>
          {attachmentStatus && (
            <p
              className={cn(
                'mt-2 text-xs',
                attachmentStatus.kind === 'success' ? 'text-success' : 'text-danger',
              )}
              role="status"
            >
              {attachmentStatus.message}
              {savedAttachmentId && (
                <button
                  type="button"
                  className="ml-2 inline-flex items-center gap-1 font-medium underline underline-offset-2"
                  onClick={() => void window.emzero.messages.revealSavedAttachment(savedAttachmentId)}
                >
                  <FolderOpen className="size-3.5" />
                  Show in folder
                </button>
              )}
            </p>
          )}
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
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(() => signatureBody(account.id));
  const [attachments, setAttachments] = useState<MailOutgoingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<MailSendDraft | null>(null);
  const confirmationActionRef = useRef<HTMLButtonElement>(null);
  const currentDraft = { ...createReplyDraft(account, summary, message, text), attachments };
  const { status: draftStatus, handoffSavedDraft, discardSavedDraft } = useDraftAutosave(
    account.id,
    currentDraft,
    open && Boolean(text.trim() || attachments.length),
  );

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
        await discardSavedDraft();
        if (result.sentMessage) onSent(result.sentMessage);
        setText('');
        setAttachments([]);
        setOpen(false);
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not send reply.' });
    } finally {
      setBusy(false);
    }
  };

  const requestSend = () => {
    const draft = currentDraft;
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
            setText((current) => current || signatureBody(account.id));
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
        className={cn(
          'mt-6 border-t border-border pt-5',
          expanded && 'fixed inset-y-0 right-0 z-50 overflow-y-auto bg-background p-6 shadow-2xl lg:left-[var(--sidebar-width)] lg:p-10',
        )}
        onSubmit={submit}
      >
        <div className="mb-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Reply className="size-4 shrink-0" />
        <span className="shrink-0">Reply to</span>
        <span className="truncate font-medium text-foreground">{addressDetails(recipients)}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            className="size-8 px-0"
            aria-label={expanded ? 'Return reply to conversation' : 'Expand reply to message area'}
            title={expanded ? 'Return reply to conversation' : 'Expand reply to message area'}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="size-8 px-0"
            aria-label="Open reply in new window"
            title="Open reply in new window"
            onClick={() => {
              void handoffSavedDraft().then((reference) => window.emzero.openMailWindow({
                kind: 'composer',
                composerKind: 'reply',
                accountId: account.id,
                draft: currentDraft,
                ...(reference ? { draftReference: reference } : {}),
              })).then((opened) => { if (opened) setOpen(false); });
            }}
          >
            <ExternalLink className="size-4" />
          </Button>
        </div>
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
        <div className="mt-2">
          <AttachmentPicker
            attachments={attachments}
            disabled={busy}
            onChange={(nextAttachments) => {
              setAttachments(nextAttachments);
              setStatus(null);
            }}
            onError={(errorMessage) => setStatus({ kind: 'error', message: errorMessage })}
          />
        </div>
        {draftStatus.state !== 'idle' && (
          <p
            className={draftStatus.state === 'error' ? 'mt-2 text-xs text-danger' : 'mt-2 text-xs text-muted-foreground'}
            role="status"
          >
            {draftStatus.state === 'saving' ? 'Saving draft…' : draftStatus.message}
          </p>
        )}
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
              void discardSavedDraft().then((deleted) => {
                if (!deleted) return;
                setOpen(false);
                setExpanded(false);
                setText('');
                setAttachments([]);
                setStatus(null);
              });
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
  isSavedDraft,
  draftEditorOpen,
  draftEditBlocked,
  onEditDraft,
  onCloseDraft,
  defaultExpanded,
  onReplySent,
  onDraftSaved,
  onDraftSent,
  demoDetail,
}: {
  selection: FolderSelection;
  summary: MailMessageSummary;
  isSavedDraft: boolean;
  draftEditorOpen: boolean;
  draftEditBlocked: boolean;
  onEditDraft: () => void;
  onCloseDraft: () => void;
  defaultExpanded: boolean;
  onReplySent: (message: MailMessageSummary) => void;
  onDraftSaved?: (event: DraftSavedEvent) => void;
  onDraftSent?: () => void;
  demoDetail?: MailMessageDetail;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [state, setState] = useState<MessageDetailLoadState>(
    demoDetail ? { status: 'loaded', message: demoDetail } : { status: 'loading' },
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [draftAttachments, setDraftAttachments] = useState<MailOutgoingAttachment[] | null>(
    isSavedDraft && (!demoDetail || demoDetail.attachments.some((attachment) => !attachment.related))
      ? null
      : [],
  );
  const [draftAttachmentError, setDraftAttachmentError] = useState<string | null>(null);
  const [deleteDraftConfirmationOpen, setDeleteDraftConfirmationOpen] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);

  useEffect(() => {
    if (demoDetail) return;
    if (!expanded || state.status !== 'loading') return;
    let active = true;
    void window.emzero.messages
      .get(selection.account.id, summary.folderPath, summary.uid)
      .then((result) => {
        if (!active) return;
        if (result.ok && result.messageDetail) {
          setState({ status: 'loaded', message: result.messageDetail });
          if (
            isSavedDraft &&
            !result.messageDetail.attachments.some((attachment) => !attachment.related)
          ) {
            setDraftAttachments([]);
          }
        } else {
          setState({ status: 'error', message: result.message ?? 'Could not load message.' });
        }
      })
      .catch(() => {
        if (active) setState({ status: 'error', message: 'Could not load message.' });
      });
    return () => {
      active = false;
    };
  }, [demoDetail, expanded, isSavedDraft, refreshKey, selection.account.id, state.status, summary.folderPath, summary.uid]);

  useEffect(() => {
    if (
      demoDetail ||
      !isSavedDraft ||
      !draftEditorOpen ||
      state.status !== 'loaded' ||
      draftAttachments !== null
    ) return;
    let active = true;
    void window.emzero.messages.prepareDraftAttachments(
      selection.account.id,
      summary.folderPath,
      summary.uid,
    ).then((result) => {
      if (!active) return;
      setDraftAttachments(result.attachments);
      setDraftAttachmentError(result.ok ? null : (result.message ?? 'Could not load draft attachments.'));
    }).catch(() => {
      if (!active) return;
      setDraftAttachments([]);
      setDraftAttachmentError('Could not load draft attachments.');
    });
    return () => { active = false; };
  }, [demoDetail, draftAttachments, draftEditorOpen, isSavedDraft, selection.account.id, state.status, summary.folderPath, summary.uid]);

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
        onClick={() => {
          if (!draftEditorOpen) setExpanded((current) => !current);
        }}
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
          {isSavedDraft && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              Draft
            </span>
          )}
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
              {draftEditorOpen && draftAttachments === null ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  Preparing draft
                </div>
              ) : draftEditorOpen ? (
                <ComposeDialog
                  open
                  accounts={[selection.account]}
                  defaultAccountId={selection.account.id}
                  composerKind="draft"
                  variant="floating"
                  initialDraft={{
                    to: state.message.to,
                    cc: state.message.cc,
                    bcc: [],
                    subject: state.message.subject,
                    text: state.message.text,
                    inReplyTo: summary.inReplyTo,
                    references: summary.references,
                    attachments: draftAttachments ?? [],
                  }}
                  initialDraftReference={{ folderPath: summary.folderPath, uid: summary.uid }}
                  onOpenChange={(open) => { if (!open) onCloseDraft(); }}
                  onDraftSaved={onDraftSaved}
                  onSent={(sentMessage) => {
                    if (sentMessage) onReplySent(sentMessage);
                    onDraftSent?.();
                  }}
                  onDeleted={onDraftSent}
                />
              ) : <MessageBody
                accountId={selection.account.id}
                folderPath={summary.folderPath}
                message={state.message}
                demo={Boolean(demoDetail)}
              />}
              {!draftEditorOpen && isSavedDraft ? (
                <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
                  <Button
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    disabled={deletingDraft}
                    onClick={() => setDeleteDraftConfirmationOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={draftEditBlocked}
                    title={draftEditBlocked ? 'Close the current draft editor first.' : undefined}
                    onClick={onEditDraft}
                  >
                    Edit draft
                  </Button>
                </div>
              ) : !draftEditorOpen && demoDetail ? (
                <div className="mt-6 border-t border-border pt-5">
                  <Button variant="secondary" title="Sending is disabled for sample messages">
                    <Reply className="size-4" />
                    Reply
                  </Button>
                </div>
              ) : !draftEditorOpen ? <ReplyComposer
                account={selection.account}
                summary={summary}
                message={state.message}
                onSent={onReplySent}
              /> : null}
              {draftAttachmentError && (
                <p className="mt-3 text-xs text-danger" role="status">{draftAttachmentError}</p>
              )}
              <AlertDialog
                open={deleteDraftConfirmationOpen}
                onOpenChange={setDeleteDraftConfirmationOpen}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This draft will be permanently removed from the mail server.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={deletingDraft}
                      onClick={() => {
                        setDeletingDraft(true);
                        void window.emzero.messages.deleteDraft(selection.account.id, {
                          folderPath: summary.folderPath,
                          uid: summary.uid,
                        }).then((result) => {
                          if (!result.ok) {
                            setDraftAttachmentError(result.message ?? 'Could not delete draft.');
                            return;
                          }
                          setDeleteDraftConfirmationOpen(false);
                          onDraftSent?.();
                        }).catch(() => {
                          setDraftAttachmentError('Could not delete draft.');
                        }).finally(() => setDeletingDraft(false));
                      }}
                    >
                      <Trash2 className="size-4" />
                      Delete draft
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function ConversationReader({
  accounts,
  selection,
  folders,
  conversation,
  onBack,
  navigationVariant = 'back',
  nativeWindow = false,
  busy,
  actionError,
  onSetUnread,
  onSetFlagged,
  onMove,
  onDelete,
  onReplySent,
  onDraftSaved,
  onDraftSent,
  demoDetails,
}: {
  accounts: AccountSummary[];
  selection: FolderSelection;
  folders: MailFolderSummary[];
  conversation: MailConversation;
  onBack: () => void;
  navigationVariant?: 'back' | 'close';
  nativeWindow?: boolean;
  busy: boolean;
  actionError: string | null;
  onSetUnread: (unread: boolean) => void;
  onSetFlagged: (flagged: boolean) => void;
  onMove: (destination: MessageMoveDestination) => void;
  onDelete: () => void;
  onReplySent: (message: MailMessageSummary) => void;
  onDraftSaved?: (event: DraftSavedEvent) => void;
  onDraftSent?: () => void;
  demoDetails?: ReadonlyMap<string, MailMessageDetail>;
}) {
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const { markReadOnOpen } = useTheme();
  const markedReadConversation = useRef<string | null>(null);
  const nativeMacWindow = nativeWindow && window.emzero?.platform === 'darwin';
  const unread = conversation.messages.some(
    (message) => message.folderPath === selection.folder.path && message.unread,
  );
  const flagged = conversation.messages.some(
    (message) => message.folderPath === selection.folder.path && message.flagged,
  );
  const draftFolderPaths = new Set(
    folders.filter((folder) => folder.specialUse === '\\Drafts').map((folder) => folder.path),
  );
  const [activeDraftKey, setActiveDraftKey] = useState<string | null>(null);

  useEffect(() => {
    const key = `${selection.account.id}:${selection.folder.path}:${conversation.id}`;
    if (!markReadOnOpen || !unread || busy || markedReadConversation.current === key) return;
    markedReadConversation.current = key;
    onSetUnread(false);
  }, [busy, conversation.id, markReadOnOpen, onSetUnread, selection.account.id, selection.folder.path, unread]);

  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        deleteButtonRef.current?.click();
        return;
      }
      if (event.key.toLowerCase() === 'q' && event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (!busy) onSetUnread(!unread);
      }
    };
    window.addEventListener('keydown', handleKeyboardShortcut);
    return () => window.removeEventListener('keydown', handleKeyboardShortcut);
  }, [busy, onBack, onSetUnread, unread]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className={cn(
        'flex items-center gap-3 border-b border-border bg-card py-3 pl-16 pr-4 lg:px-4',
        window.emzero?.platform === 'darwin' && 'macos-content-header macos-titlebar-drag',
        nativeMacWindow && 'macos-native-window-header',
      )}>
        {navigationVariant === 'close' && !nativeMacWindow ? (
          <Button
            variant="ghost"
            className="size-9 px-0"
            aria-label="Close message"
            title="Close message"
            onClick={onBack}
          >
            <X className="size-4" />
          </Button>
        ) : navigationVariant === 'back' ? (
          <Button variant="ghost" className="px-3" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
        ) : null}
        <span className="truncate text-sm text-muted-foreground">
          {selection.account.name} / {displayFolderName(selection.folder)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!nativeWindow && <Button
            variant="ghost"
            className="size-9 px-0"
            aria-label="Open conversation in new window"
            title="Open conversation in new window"
            onClick={() => {
              const target = conversation.messages.find(
                (message) => message.folderPath === selection.folder.path,
              ) ?? conversation.messages[0];
              void window.emzero.openMailWindow({
                kind: 'message',
                accountId: selection.account.id,
                folderPath: target.folderPath,
                uid: target.uid,
              });
            }}
          >
            <ExternalLink className="size-4" />
          </Button>}
          <ConversationActions
            accounts={accounts}
            sourceAccountId={selection.account.id}
            folders={folders}
            sourcePath={selection.folder.path}
            messageCount={messageCountInFolder(conversation, selection.folder.path)}
            unread={unread}
            flagged={flagged}
            busy={busy}
            confirmPermanentDelete={selection.folder.specialUse === '\\Trash'}
            onSetUnread={onSetUnread}
            onSetFlagged={onSetFlagged}
            onMove={onMove}
            onDelete={onDelete}
            deleteButtonRef={deleteButtonRef}
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
            {conversation.messages.map((message, index) => {
              const messageKey = `${message.folderPath}:${message.uid}`;
              const isSavedDraft = draftFolderPaths.has(message.folderPath);
              return (
                <ThreadMessageCard
                  key={messageKey}
                  selection={selection}
                  summary={message}
                  isSavedDraft={isSavedDraft}
                  draftEditorOpen={isSavedDraft && activeDraftKey === messageKey}
                  draftEditBlocked={activeDraftKey !== null && activeDraftKey !== messageKey}
                  onEditDraft={() => setActiveDraftKey(messageKey)}
                  onCloseDraft={() => setActiveDraftKey(null)}
                  defaultExpanded={
                    index === 0 ||
                    (isSavedDraft && (
                      selection.folder.specialUse === '\\Drafts' ||
                      activeDraftKey === messageKey
                    ))
                  }
                  onReplySent={onReplySent}
                  onDraftSaved={onDraftSaved}
                  onDraftSent={onDraftSent}
                  demoDetail={demoDetails?.get(
                    `${selection.account.id}:${message.folderPath}:${message.uid}`,
                  )}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
