import { useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
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
import type { MailSendDraft } from '../../shared/accounts';
import { sendShortcutLabel } from './app-shared';
import { addressDetails } from './mail-common';

export function SendConfirmationDialog({
  draft,
  fromAddress,
  onCancel,
  onConfirm,
}: {
  draft: MailSendDraft | null;
  fromAddress: string;
  onCancel: () => void;
  onConfirm: (draft: MailSendDraft, dontShowAgain: boolean) => void;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const confirmationActionRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      open={Boolean(draft)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
        else setDontShowAgain(false);
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
        {draft && (
          <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
            <p className="truncate">
              <span className="text-muted-foreground">From: </span>
              {fromAddress}
            </p>
            <p className="mt-1 truncate">
              <span className="text-muted-foreground">To: </span>
              {addressDetails(draft.to)}
            </p>
            {draft.cc.length > 0 && (
              <p className="mt-1 truncate">
                <span className="text-muted-foreground">Cc: </span>
                {addressDetails(draft.cc)}
              </p>
            )}
            <p className="mt-1 truncate">
              <span className="text-muted-foreground">Subject: </span>
              {draft.subject}
            </p>
            {draft.attachments.length > 0 && (
              <p className="mt-1 truncate">
                <span className="text-muted-foreground">Attachments: </span>
                {draft.attachments.length}
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
            onClick={() => { if (draft) onConfirm(draft, dontShowAgain); }}
          >
            <Send className="size-4" />
            Send email
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteDraftDialog({
  open,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            The saved draft will be permanently removed from the mail server.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function KeepDraftDialog({
  open,
  busy,
  onOpenChange,
  onDelete,
  onKeep,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onKeep: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Keep this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            Keep it in Drafts so you can continue later, or delete it permanently.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continue editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete draft
          </AlertDialogAction>
          <AlertDialogAction variant="default" disabled={busy} onClick={onKeep}>
            Keep draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
