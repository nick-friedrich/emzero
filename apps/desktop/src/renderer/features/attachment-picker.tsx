import { useState } from 'react';
import { File as FileIcon, FileImage, FileText, LoaderCircle, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MailOutgoingAttachment } from '../../shared/accounts';
import { fileSize } from './mail-common';

type MergeResult = { ok: true; attachments: MailOutgoingAttachment[] } | { ok: false; message: string };

/** Add newly authorized attachments while keeping the composer's count and size limits. */
export function mergeAttachments(
  current: MailOutgoingAttachment[],
  incoming: MailOutgoingAttachment[],
): MergeResult {
  const combined = [
    ...current,
    ...incoming.filter((candidate) => !current.some((attachment) => attachment.id === candidate.id)),
  ];
  if (combined.length > 20) return { ok: false, message: 'Attach no more than 20 files.' };
  if (combined.reduce((total, attachment) => total + attachment.size, 0) > 50 * 1024 * 1024) {
    return { ok: false, message: 'Attachments cannot exceed 50 MB in total.' };
  }
  return { ok: true, attachments: combined };
}

/** Hand dropped or pasted files to the main process, which keeps their bytes for sending. */
export async function authorizeDroppedFiles(files: File[]): Promise<MergeResult> {
  if (files.length > 20) return { ok: false, message: 'Attach no more than 20 files.' };
  const tooLarge = files.find((file) => file.size > 25 * 1024 * 1024);
  if (tooLarge) return { ok: false, message: `${tooLarge.name} exceeds the 25 MB per-file limit.` };
  if (files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
    return { ok: false, message: 'Attachments cannot exceed 50 MB in total.' };
  }
  try {
    const result = await window.emzero.messages.addDroppedAttachments(await Promise.all(
      files.map(async (file) => ({ filename: file.name || 'attachment', content: new Uint8Array(await file.arrayBuffer()) })),
    ));
    return result.ok
      ? { ok: true, attachments: result.attachments }
      : { ok: false, message: result.message ?? 'Could not attach these files.' };
  } catch {
    return { ok: false, message: 'Could not attach these files. Folders cannot be attached.' };
  }
}

function attachmentIcon(filename: string) {
  if (/\.(png|jpe?g|gif|webp|heic|svg)$/i.test(filename)) return FileImage;
  if (/\.(pdf|txt|md|docx?|rtf|pages|odt)$/i.test(filename)) return FileText;
  return FileIcon;
}

export function AttachmentList({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: MailOutgoingAttachment[];
  disabled: boolean;
  onRemove: (attachment: MailOutgoingAttachment) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Selected attachments">
      {attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment.filename);
        return (
          <span
            key={attachment.id}
            className="group flex min-w-0 max-w-64 items-center gap-2.5 rounded-xl border border-border bg-background/60 py-1.5 pl-2 pr-1.5"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-xs font-medium">{attachment.filename}</span>
              <span className="block text-[0.68rem] text-muted-foreground">{fileSize(attachment.size)}</span>
            </span>
            <button
              type="button"
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${attachment.filename}`}
              disabled={disabled}
              onClick={() => onRemove(attachment)}
            >
              <X className="size-3.5" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function AttachButton({
  attachments,
  disabled,
  className,
  onChange,
  onError,
}: {
  attachments: MailOutgoingAttachment[];
  disabled: boolean;
  className?: string;
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
      const merged = mergeAttachments(attachments, result.attachments);
      if (merged.ok) onChange(merged.attachments);
      else onError(merged.message);
    } catch {
      onError('Could not select attachments.');
    } finally {
      setSelecting(false);
    }
  };

  return (
    <button
      type="button"
      className={cn('grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50', className)}
      aria-label="Attach files"
      title="Attach files — or drop them anywhere on the message"
      disabled={disabled || selecting}
      onClick={() => void select()}
    >
      {selecting ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
    </button>
  );
}
