import { useState } from 'react';
import { LoaderCircle, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailOutgoingAttachment } from '../../shared/accounts';
import { fileSize } from './mail-common';

export function AttachmentPicker({
  attachments,
  disabled,
  onChange,
  onError,
}: {
  attachments: MailOutgoingAttachment[];
  disabled: boolean;
  onChange: (attachments: MailOutgoingAttachment[]) => void;
  onError: (message: string) => void;
}) {
  const [selecting, setSelecting] = useState(false);

  const select = async () => {
    setSelecting(true);
    try {
      const result = await window.emzero.messages.selectAttachments();
      if (!result.ok) {
        onError(result.message ?? 'Could not select attachments.');
        return;
      }
      const combined = [
        ...attachments,
        ...result.attachments.filter(
          (candidate) => !attachments.some((attachment) => attachment.id === candidate.id),
        ),
      ];
      if (combined.length > 20) {
        onError('Attach no more than 20 files.');
        return;
      }
      if (combined.reduce((total, attachment) => total + attachment.size, 0) > 50 * 1024 * 1024) {
        onError('Attachments cannot exceed 50 MB in total.');
        return;
      }
      onChange(combined);
    } catch {
      onError('Could not select attachments.');
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div>
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-label="Selected attachments">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs"
            >
              <Paperclip className="size-3.5 shrink-0" />
              <span className="max-w-52 truncate font-medium">{attachment.filename}</span>
              <span className="shrink-0 text-muted-foreground">{fileSize(attachment.size)}</span>
              <button
                type="button"
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${attachment.filename}`}
                disabled={disabled || selecting}
                onClick={() => onChange(attachments.filter((candidate) => candidate.id !== attachment.id))}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        className="h-8 px-2.5 text-xs"
        disabled={disabled || selecting}
        onClick={() => void select()}
      >
        {selecting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
        Attach files
      </Button>
    </div>
  );
}
