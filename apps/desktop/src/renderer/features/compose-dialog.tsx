import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import {
  cn,
} from '@/lib/utils';
import {
  type AccountSummary,
  type MailComposerKind,
  type MailDraftReference,
  type MailSendDraft,
  type MailOutgoingAttachment,
} from '../../shared/accounts';
import {
  parseAddressList,
  validateSendDraft,
} from '../../shared/replies';
import { sendShortcutLabel, skipSendConfirmationStorageKey, storedSkipSendConfirmation, useSendShortcut, type Status } from './app-shared';
import type { AiConversationMessage } from '../../shared/ai';
import { AttachButton, AttachmentList, authorizeDroppedFiles, mergeAttachments } from './attachment-picker';
import { AiDraftAssistant, useAiConfigured } from './ai-draft-assistant';
import { DeleteDraftDialog, KeepDraftDialog, SendConfirmationDialog } from './compose-confirmations';
import { useDraftAutosave } from './draft-autosave';
import { SignaturePicker } from './signature-picker';
import { RecipientInput, initialRecipientValue } from './recipient-input';
import { RichTextEditor, type RichTextEditorHandle } from './rich-text-editor';
import { htmlFromText } from './clipboard-html';
import { messageHtml, signatureBlock, signatureHtml, withSignatureBlock } from './signature-html';
import { formatSignature, replaceSignature, signatureBody, signatureBodyForId, signatureIdForAccount, signatureSeparator, signatureSuffix } from './signatures';

export interface DraftSavedEvent {
  accountId: string;
  reference: MailDraftReference;
}

export interface DraftDeletedEvent {
  accountId: string;
  references: MailDraftReference[];
}

export function ComposeDialog({
  open,
  accounts,
  defaultAccountId,
  onOpenChange,
  onSent,
  initialDraft,
  initialDraftReference,
  composerKind = 'new',
  loadConversation,
  variant = 'page',
  onDraftSaved,
  onDeleted,
  title,
}: {
  open: boolean;
  accounts: AccountSummary[];
  defaultAccountId: string | null;
  onOpenChange: (open: boolean) => void;
  onSent: (message?: import('../../shared/accounts').MailMessageSummary) => void;
  initialDraft?: MailSendDraft;
  initialDraftReference?: MailDraftReference;
  composerKind?: MailComposerKind;
  loadConversation?: () => Promise<AiConversationMessage[]>;
  variant?: 'page' | 'inline' | 'window';
  onDraftSaved?: (event: DraftSavedEvent) => void;
  onDeleted?: (event: DraftDeletedEvent) => void;
  /** Heading override, for example "Reply all". */
  title?: string;
}) {
  const [accountId, setAccountId] = useState(() =>
    accounts.some((account) => account.id === defaultAccountId)
      ? defaultAccountId!
      : (accounts[0]?.id ?? ''),
  );
  const [to, setTo] = useState(() => initialRecipientValue(initialDraft?.to ?? []));
  const [cc, setCc] = useState(() => initialRecipientValue(initialDraft?.cc ?? []));
  const [bcc, setBcc] = useState(() => initialRecipientValue(initialDraft?.bcc ?? []));
  const [subject, setSubject] = useState(initialDraft?.subject ?? '');
  const [body, setBody] = useState(() => {
    const initialText = initialDraft?.text ?? '';
    return initialText || composerKind === 'draft' ? initialText : signatureBody(
      accounts.some((account) => account.id === defaultAccountId) ? defaultAccountId! : (accounts[0]?.id ?? ''),
    );
  });
  const [bodyHtml, setBodyHtml] = useState(() => {
    if (initialDraft?.html) return initialDraft.html;
    const initialAccountId = accounts.some((account) => account.id === defaultAccountId)
      ? defaultAccountId!
      : (accounts[0]?.id ?? '');
    const text = initialDraft?.text || (composerKind === 'draft' ? '' : signatureBody(initialAccountId));
    return messageHtml(text, signatureBodyForId(signatureIdForAccount(initialAccountId)));
  });
  const [signatureId, setSignatureId] = useState(() => {
    const initialAccountId = accounts.some((account) => account.id === defaultAccountId)
      ? defaultAccountId!
      : (accounts[0]?.id ?? '');
    const assignedSignatureId = signatureIdForAccount(initialAccountId);
    const hasAssignedSignature = Boolean(
      initialDraft && signatureSuffix(initialDraft.text, assignedSignatureId),
    );
    return (!initialDraft && composerKind !== 'draft') || hasAssignedSignature
      ? assignedSignatureId
      : '';
  });
  const [attachments, setAttachments] = useState<MailOutgoingAttachment[]>(initialDraft?.attachments ?? []);
  const [expanded, setExpanded] = useState(variant === 'window');
  const [replyDetailsOpen, setReplyDetailsOpen] = useState(false);
  const compactReply = variant === 'inline' && composerKind === 'reply' && !expanded;
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [skipSendConfirmation, setSkipSendConfirmation] = useState(
    storedSkipSendConfirmation,
  );
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<MailSendDraft | null>(null);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMounted, setAiMounted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const aiConfigured = useAiConfigured();
  const sectionId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const allowWindowCloseRef = useRef(false);
  const currentDraft: MailSendDraft = {
    to: parseAddressList(to),
    cc: parseAddressList(cc),
    bcc: parseAddressList(bcc),
    subject,
    text: body,
    html: bodyHtml,
    inReplyTo: initialDraft?.inReplyTo ?? null,
    references: initialDraft?.references ?? [],
    attachments,
  };
  const hasDraftContent = Boolean(
    to.trim() || cc.trim() || bcc.trim() || subject.trim() || body.trim() || /<img\b/i.test(bodyHtml) || attachments.length,
  );
  const {
    status: draftStatus,
    savedDraftReference,
    handoffSavedDraft,
    discardSavedDraft,
    discardSavedDraftInBackground,
  } = useDraftAutosave(
    accountId,
    currentDraft,
    open && hasDraftContent,
    initialDraftReference,
  );

  // The plain-text body carries the signature after the "-- " delimiter; the HTML carries it in
  // a Signature block, which wins when present because the user may have edited it in place.
  const hasSignatureBlock = signatureBlock(bodyHtml) !== null;
  const delimiterIndex = hasSignatureBlock ? body.lastIndexOf(signatureSeparator) : -1;
  const currentSignature = delimiterIndex >= 0 ? body.slice(delimiterIndex) : signatureSuffix(body, signatureId);
  const bodyWithoutSignature = currentSignature
    ? body.slice(0, -currentSignature.length)
    : body;
  const preservedSignature = currentSignature || formatSignature(signatureBodyForId(signatureId));

  const replaceBody = (text: string) => {
    setBody(text);
    setBodyHtml(htmlFromText(text));
  };

  /** Replace the message text while keeping the signature block (and its edits) below it. */
  const replaceMessageText = (text: string) => {
    const block = signatureBlock(bodyHtml) ?? signatureHtml(signatureBodyForId(signatureId));
    setBody(block ? `${text}${preservedSignature}` : text);
    setBodyHtml(block ? `${htmlFromText(text)}<br><br>${block}` : htmlFromText(text));
  };

  const changeSignature = (nextSignatureId: string) => {
    const nextSignature = signatureBodyForId(nextSignatureId);
    if (hasSignatureBlock || !signatureSuffix(body, signatureId)) {
      setBody(`${bodyWithoutSignature}${formatSignature(nextSignature)}`);
      setBodyHtml(withSignatureBlock(bodyHtml, signatureHtml(nextSignature)));
    } else {
      // Drafts from earlier releases carry the signature only as trailing text.
      const nextText = replaceSignature(body, signatureId, nextSignatureId);
      setBody(nextText);
      setBodyHtml(messageHtml(nextText, nextSignature));
    }
    setSignatureId(nextSignatureId);
  };

  useEffect(() => {
    if (variant !== 'window') return;
    const preventUnconfirmedClose = (event: BeforeUnloadEvent) => {
      if (
        allowWindowCloseRef.current ||
        (!hasDraftContent && !savedDraftReference && !initialDraftReference)
      ) return;
      event.preventDefault();
      event.returnValue = '';
      setCloseConfirmationOpen(true);
    };
    window.addEventListener('beforeunload', preventUnconfirmedClose);
    return () => window.removeEventListener('beforeunload', preventUnconfirmedClose);
  }, [hasDraftContent, initialDraftReference, savedDraftReference, variant]);

  const finishClose = () => {
    allowWindowCloseRef.current = true;
    onOpenChange(false);
  };

  const deletedDraftEvent = (): DraftDeletedEvent => {
    const references = [savedDraftReference, initialDraftReference]
      .filter((reference): reference is MailDraftReference => Boolean(reference))
      .filter((reference, index, all) => all.findIndex(
        (candidate) => candidate.folderPath === reference.folderPath && candidate.uid === reference.uid,
      ) === index);
    return { accountId, references };
  };

  const resetComposer = () => {
    setTo('');
    setCc('');
    setBcc('');
    setSubject('');
    replaceBody('');
    setAttachments([]);
    setExpanded(variant === 'window');
  };

  const keepAndClose = () => {
    setBusy(true);
    void handoffSavedDraft().then((reference) => {
      if (!reference && hasDraftContent) {
        setCloseConfirmationOpen(false);
        return;
      }
      if (reference) onDraftSaved?.({ accountId, reference });
      setCloseConfirmationOpen(false);
      finishClose();
    }).finally(() => setBusy(false));
  };

  const deleteAndClose = () => {
    const event = deletedDraftEvent();
    const deletion = discardSavedDraftInBackground();
    const immediateReference = deletion.reference;
    if (immediateReference && !event.references.some((reference) =>
      reference.folderPath === immediateReference.folderPath &&
      reference.uid === immediateReference.uid
    )) {
      event.references.push(immediateReference);
    }
    setDeleteConfirmationOpen(false);
    setCloseConfirmationOpen(false);
    resetComposer();
    finishClose();
    onDeleted?.(event);
    void deletion.completion.then((result) => {
      if (!result.ok && result.reference) {
        onDraftSaved?.({ accountId, reference: result.reference });
      }
    });
  };

  const generateAiDraft = async (instruction: string, onProgress: (text: string) => void) => {
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account) throw new Error('Choose a sending account first.');
    return window.emzero.ai.draftMessage({
      kind: composerKind,
      prompt: instruction,
      accountEmail: account.email,
      subject,
      to: currentDraft.to,
      cc: currentDraft.cc,
      existingDraft: bodyWithoutSignature.trim(),
      conversation: await loadConversation?.() ?? [],
    }, onProgress);
  };

  const deliver = async (draft: MailSendDraft) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = composerKind === 'reply'
        ? await window.emzero.messages.sendReply(accountId, draft)
        : await window.emzero.messages.send(accountId, draft);
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.message ?? 'Could not send message.' });
        return;
      }
      const deletedEvent = deletedDraftEvent();
      const discarded = await discardSavedDraft();
      if (discarded && deletedEvent.references.length > 0) onDeleted?.(deletedEvent);
      resetComposer();
      onSent(result.sentMessage);
      finishClose();
    } catch {
      setStatus({ kind: 'error', message: 'Could not send message.' });
    } finally {
      setBusy(false);
    }
  };

  const requestSend = () => {
    const draft = currentDraft;
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
  };

  useSendShortcut(open && !busy && !aiBusy && !pendingDraft, requestSend);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    requestSend();
  };

  // Bring an inline composer into view and put the caret where the reply goes.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (variant === 'inline' && !expanded) {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
      if (composerKind === 'reply') editorRef.current?.focus('start');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerKind, expanded, open, variant]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const authorized = await authorizeDroppedFiles(files);
    const merged = authorized.ok ? mergeAttachments(attachments, authorized.attachments) : authorized;
    if (merged.ok) {
      setAttachments(merged.attachments);
      setStatus(null);
    } else {
      setStatus({ kind: 'error', message: merged.message });
    }
  };

  const draggingFiles = (event: DragEvent) => [...event.dataTransfer.types].includes('Files');

  const closeComposer = () => {
    if (busy || aiBusy) return;
    if (!hasDraftContent && !savedDraftReference && !initialDraftReference) {
      finishClose();
      return;
    }
    setCloseConfirmationOpen(true);
  };


  const disabled = busy || aiBusy;
  const fromAccount = accounts.find((account) => account.id === accountId);
  const detailsVisible = !compactReply || replyDetailsOpen;
  const ccVisible = Boolean(cc) || showCc || (compactReply && replyDetailsOpen);
  const bccVisible = Boolean(bcc) || showBcc || (compactReply && replyDetailsOpen);
  const scrolls = variant !== 'inline' || expanded;
  const sendKeys = window.emzero?.platform === 'darwin' ? '⌘↵' : 'Ctrl ↵';
  const rowButton = 'h-7 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50';

  return (
    <>
      {open && <section
        ref={sectionRef}
        className={cn(
          'z-40 flex flex-col border-border bg-card',
          variant === 'inline' && 'macos-titlebar-no-drag',
          variant === 'inline' && !expanded && 'composer-enter relative mt-6 scroll-mb-6 rounded-2xl border shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_14px_-8px_rgb(0_0_0/0.14)] transition-[border-color,box-shadow] focus-within:border-primary/35 focus-within:shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_18px_-8px_rgb(0_0_0/0.2)]',
          variant === 'page' && 'relative h-full min-h-0 min-w-0 overflow-hidden',
          expanded && variant !== 'window' && 'fixed inset-y-0 right-0 overflow-hidden border-l lg:left-[var(--sidebar-width)]',
          variant === 'window' && 'relative h-screen overflow-hidden',
        )}
        aria-label={composerKind === 'reply' ? 'Reply composer' : composerKind === 'draft' ? 'Draft editor' : 'New message'}
        onDragEnter={(event) => {
          if (!draggingFiles(event)) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!draggingFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!draggingFiles(event)) return;
          event.preventDefault();
          setDragging(false);
          if (!disabled) void addFiles([...event.dataTransfer.files]);
        }}
      >
        <header className={cn(
          'flex items-center gap-2 border-b border-border/70 px-4 py-2.5 sm:px-5',
          variant === 'page' && 'mail-pane-header gap-3 pl-16 lg:px-6',
          window.emzero?.platform === 'darwin' && variant === 'page' && 'macos-content-header macos-titlebar-drag',
          window.emzero?.platform === 'darwin' && variant === 'window' && 'macos-content-header macos-native-window-header macos-titlebar-drag',
        )}>
          {variant === 'page' && <Button type="button" variant="ghost"
            className="size-8 shrink-0 px-0" disabled={disabled}
            aria-label="Back to mailbox" title="Back to mailbox" onClick={closeComposer}>
            <ArrowLeft className="size-4" />
          </Button>}
          <div className="min-w-0">
            <h2 className={cn('truncate font-semibold', variant === 'page' ? 'text-lg tracking-tight' : 'text-sm')}>
              {title ?? (composerKind === 'reply' ? 'Reply' : composerKind === 'draft' ? 'Edit draft' : 'New message')}
            </h2>
            {subject && variant !== 'inline' && <p className="truncate text-xs text-muted-foreground">{subject}</p>}
            {variant === 'inline' && fromAccount && <p className="truncate text-xs text-muted-foreground">from {fromAccount.email}</p>}
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            {(hasDraftContent || savedDraftReference || initialDraftReference) && <Button
              type="button"
              variant="ghost"
              className="size-8 px-0 text-muted-foreground hover:text-danger"
              disabled={disabled}
              aria-label="Delete draft"
              title="Delete draft"
              onClick={() => setDeleteConfirmationOpen(true)}
            >
              <Trash2 className="size-4" />
            </Button>}
            {variant === 'inline' && <Button
              type="button"
              variant="ghost"
              className="size-8 px-0 text-muted-foreground"
              disabled={aiBusy}
              aria-label={expanded ? 'Return to compact composer' : 'Expand to message area'}
              title={expanded ? 'Return to compact composer' : 'Expand to message area'}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>}
            {variant !== 'window' && <Button
              type="button"
              variant="ghost"
              className="size-8 px-0 text-muted-foreground"
              disabled={aiBusy}
              aria-label="Open in new window"
              title="Open in new window"
              onClick={() => {
                void handoffSavedDraft().then(async (reference) => {
                  if (reference) onDraftSaved?.({ accountId, reference });
                  const opened = await window.emzero.openMailWindow({
                    kind: 'composer',
                    composerKind,
                    accountId,
                    draft: currentDraft,
                    ...(reference ? { draftReference: reference } : {}),
                  });
                  if (opened) finishClose();
                });
              }}
            >
              <ExternalLink className="size-4" />
            </Button>}
            {variant !== 'page' && <Button
              type="button"
              variant="ghost"
              className="size-8 px-0 text-muted-foreground"
              disabled={disabled}
              aria-label="Close composer"
              title="Close composer"
              onClick={closeComposer}
            >
              <X className="size-4" />
            </Button>}
          </div>
        </header>
        <form className={cn('flex flex-col', scrolls && 'min-h-0 flex-1')} onSubmit={submit}>
          <div className={cn(scrolls && 'min-h-0 flex-1 overflow-y-auto')}>
            <div className={cn('flex min-h-full flex-col', variant === 'page' && 'mx-auto max-w-3xl')}>
              {detailsVisible && accounts.length > 1 && (
                <div className="flex min-h-11 items-center gap-2 border-b border-border/70 px-4 sm:px-5">
                  <span className="w-14 shrink-0 text-sm text-muted-foreground" aria-hidden="true">From</span>
                  <div className="relative min-w-0 flex-1">
                    <select
                      className="h-10 w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-7 text-sm outline-none"
                      value={accountId}
                      disabled={disabled}
                      aria-label="From"
                      onChange={(event) => {
                        const nextAccountId = event.target.value;
                        changeSignature(signatureIdForAccount(nextAccountId));
                        setAccountId(nextAccountId);
                        setStatus(null);
                      }}
                    >
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} — {account.email}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1 top-3 size-4 text-muted-foreground" />
                  </div>
                </div>
              )}
              <RecipientInput
                label="To"
                accountId={accountId}
                value={to}
                placeholder="Name or email address"
                autoFocus={composerKind === 'new' && !to}
                disabled={disabled}
                onChange={(value) => {
                  setTo(value);
                  setStatus(null);
                }}
                trailing={<>
                  {!ccVisible && <button type="button" className={rowButton} disabled={disabled}
                    onClick={() => setShowCc(true)}>Cc</button>}
                  {!bccVisible && <button type="button" className={rowButton} disabled={disabled}
                    onClick={() => setShowBcc(true)}>Bcc</button>}
                  {compactReply && <button type="button" className={cn(rowButton, 'flex items-center gap-1.5')}
                    aria-expanded={replyDetailsOpen} title="Edit From, Cc, Bcc, and subject"
                    onClick={() => setReplyDetailsOpen((current) => !current)}>
                    <SlidersHorizontal className="size-3.5" />
                    {replyDetailsOpen ? 'Hide details' : 'Edit details'}
                  </button>}
                </>}
              />
              {ccVisible && <RecipientInput
                label="Cc"
                accountId={accountId}
                value={cc}
                autoFocus={showCc && !cc}
                disabled={disabled}
                onChange={(value) => {
                  setCc(value);
                  setStatus(null);
                }}
              />}
              {bccVisible && <RecipientInput
                label="Bcc"
                accountId={accountId}
                value={bcc}
                autoFocus={showBcc && !bcc}
                disabled={disabled}
                onChange={(value) => {
                  setBcc(value);
                  setStatus(null);
                }}
              />}
              {detailsVisible && (
                <div className="flex min-h-11 items-center gap-2 border-b border-border/70 px-4 sm:px-5">
                  <label htmlFor={`${sectionId}-subject`} className="w-14 shrink-0 text-sm text-muted-foreground">Subject</label>
                  <input
                    id={`${sectionId}-subject`}
                    className="h-10 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
                    value={subject}
                    placeholder="What is this about?"
                    disabled={disabled}
                    onChange={(event) => {
                      setSubject(event.target.value);
                      setStatus(null);
                    }}
                  />
                </div>
              )}
              {aiMounted && (
                <div className="px-4 pt-4 sm:px-5" hidden={!aiOpen}>
                  <AiDraftAssistant
                    disabled={busy || !accountId}
                    currentText={bodyWithoutSignature}
                    actionLabel={composerKind === 'draft' ? 'Rewrite draft' : 'Draft message'}
                    placeholder={composerKind === 'draft'
                      ? 'For example: Make this warmer and more concise.'
                      : composerKind === 'reply'
                        ? 'For example: Thank them and propose Tuesday at 10.'
                        : 'For example: Ask for a project update and suggest a call next week.'}
                    privacyDescription={loadConversation
                      ? "The conversation, your existing text, and your instruction will be sent to your configured AI provider."
                      : "Your recipients, subject, existing draft, and instruction will be sent to your configured AI provider."}
                    onGenerate={generateAiDraft}
                    onApply={(draft) => {
                      replaceMessageText(draft);
                      setStatus(null);
                    }}
                    onBusyChange={setAiBusy}
                    onClose={() => setAiOpen(false)}
                  />
                </div>
              )}
              <div
                className={cn('flex-1 cursor-text px-4 py-4 sm:px-5', scrolls && 'pb-8')}
                onMouseDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  event.preventDefault();
                  editorRef.current?.focus('end');
                }}
              >
                <RichTextEditor
                  ref={editorRef}
                  html={bodyHtml}
                  placeholder={composerKind === 'reply' ? 'Write your reply…' : 'Write your message…'}
                  className={scrolls ? 'min-h-64' : undefined}
                  toolbarContainer={toolbarContainer}
                  disabled={disabled}
                  onChange={(html, text) => {
                    setBodyHtml(html);
                    setBody(text);
                    setStatus(null);
                  }}
                  onError={(message) => setStatus({ kind: 'error', message })}
                  onPasteFiles={(files) => void addFiles(files)}
                />
              </div>
              {attachments.length > 0 && (
                <div className="px-4 pb-4 sm:px-5">
                  <AttachmentList
                    attachments={attachments}
                    disabled={disabled}
                    onRemove={(attachment) => {
                      setAttachments((current) => current.filter((candidate) => candidate.id !== attachment.id));
                      setStatus(null);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          {status && (
            <div
              className={cn(
                'mx-3 mb-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm sm:mx-4',
                status.kind === 'success' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
              )}
              role="status"
            >
              {status.kind === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}
              <span className="min-w-0 flex-1">{status.message}</span>
              <button type="button" className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
                aria-label="Dismiss" onClick={() => setStatus(null)}><X className="size-3.5" /></button>
            </div>
          )}
          <div className={cn(
            'border-t border-border/70 bg-card px-3 py-2 sm:px-4',
            variant === 'inline' && !expanded && 'rounded-b-2xl',
          )}>
          <div className={cn('flex flex-wrap items-center gap-x-1 gap-y-2', variant === 'page' && 'mx-auto max-w-3xl')}>
            <div ref={setToolbarContainer} className="min-w-0" />
            <div className="mx-1 hidden h-5 w-px bg-border/70 sm:block" aria-hidden="true" />
            <AttachButton
              attachments={attachments}
              disabled={disabled}
              onChange={(nextAttachments) => {
                setAttachments(nextAttachments);
                setStatus(null);
              }}
              onError={(message) => setStatus({ kind: 'error', message })}
            />
            {aiConfigured && <button
              type="button"
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50',
                aiOpen && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
              )}
              aria-pressed={aiOpen}
              title="Draft with AI"
              disabled={busy || aiBusy}
              onClick={() => {
                setAiMounted(true);
                setAiOpen((current) => !current);
              }}
            >
              <Sparkles className="size-4" />
              <span className="hidden sm:inline">AI</span>
            </button>}
            <SignaturePicker
              value={signatureId}
              disabled={disabled}
              onChange={(nextSignatureId) => {
                changeSignature(nextSignatureId);
                setStatus(null);
              }}
            />
            <div className="ml-auto flex items-center gap-3 pl-2">
              {draftStatus.state !== 'idle' && (
                <span
                  className={cn('flex items-center gap-1 text-xs',
                    draftStatus.state === 'error' ? 'text-danger' : 'text-muted-foreground')}
                  role="status"
                  title={draftStatus.state === 'saving' ? undefined : draftStatus.message}
                >
                  {draftStatus.state === 'saving' && <><LoaderCircle className="size-3 animate-spin" />Saving…</>}
                  {draftStatus.state === 'saved' && <><Check className="size-3" />Saved</>}
                  {draftStatus.state === 'error' && <><AlertCircle className="size-3" />{draftStatus.message}</>}
                </span>
              )}
              <Button
                type="submit"
                className="h-9 rounded-full pl-4 pr-2.5 text-sm shadow-sm"
                disabled={disabled || !accountId}
                aria-label="Send"
                title={`Send (${sendShortcutLabel()})`}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send
                <kbd className="rounded-full bg-primary-foreground/15 px-1.5 py-0.5 font-sans text-[0.65rem] font-medium">{sendKeys}</kbd>
              </Button>
            </div>
          </div>
          </div>
        </form>
        {dragging && (
          <div className="pointer-events-none absolute inset-1.5 z-40 grid place-items-center rounded-xl border-2 border-dashed border-primary/60 bg-card/85 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Paperclip className="size-6" />
              <p className="text-sm font-medium">Drop files to attach</p>
            </div>
          </div>
        )}
      </section>}
      <SendConfirmationDialog
        draft={pendingDraft}
        fromAddress={fromAccount?.email ?? ''}
        onCancel={() => setPendingDraft(null)}
        onConfirm={(draft, dontShowAgain) => {
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
      />
      <DeleteDraftDialog
        open={deleteConfirmationOpen}
        onOpenChange={setDeleteConfirmationOpen}
        onDelete={deleteAndClose}
      />
      <KeepDraftDialog
        open={closeConfirmationOpen}
        busy={busy}
        onOpenChange={setCloseConfirmationOpen}
        onDelete={deleteAndClose}
        onKeep={keepAndClose}
      />
    </>
  );
}
