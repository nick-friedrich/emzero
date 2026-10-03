import type { AccountSummary, MailMessageDetail, MailMessageSummary } from '../../shared/accounts';
import type { AiConversationMessage } from '../../shared/ai';
import { createReplyDraft, replyAllCcRecipients, replyRecipients, type ReplyMode } from '../../shared/replies';
import { ComposeDialog, type DraftDeletedEvent, type DraftSavedEvent } from './compose-dialog';
import { signatureBody } from './signatures';
import { Reply, ReplyAll } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ReplyComposer({
  account,
  summary,
  message,
  threadMessages,
  open,
  mode,
  onOpenChange,
  onSent,
  onDraftSaved,
  onDraftDeleted,
}: {
  account: AccountSummary;
  summary: MailMessageSummary;
  message: MailMessageDetail;
  threadMessages: MailMessageSummary[];
  open: boolean;
  mode: ReplyMode;
  onOpenChange: (open: boolean, mode?: ReplyMode) => void;
  onSent: (message: MailMessageSummary) => void;
  onDraftSaved?: (event: DraftSavedEvent) => void;
  onDraftDeleted?: (event: DraftDeletedEvent) => void;
}) {
  const canReply = replyRecipients(account, message).length > 0;
  const canReplyAll = canReply && replyAllCcRecipients(account, message).length > 0;

  const loadConversation = async () => {
    try {
      const loadedConversation = await Promise.all(
        threadMessages.slice(0, 100).reverse().map(async (threadSummary) => {
          const current =
            threadSummary.folderPath === summary.folderPath && threadSummary.uid === summary.uid;
          const detail = current
            ? message
            : await window.emzero.messages
                .get(account.id, threadSummary.folderPath, threadSummary.uid)
                .then((result) => {
                  if (!result.ok || !result.messageDetail) {
                    throw new Error(result.message ?? 'Could not load a message in this conversation.');
                  }
                  return result.messageDetail;
                });
          return {
            sentAt: detail.sentAt ?? threadSummary.sentAt ?? threadSummary.receivedAt,
            from: detail.from,
            to: detail.to,
            text: detail.text,
          };
        }),
      );
      const conversation: AiConversationMessage[] = [];
      let remainingTextLength = 1_000_000;
      for (let index = loadedConversation.length - 1; index >= 0; index -= 1) {
        if (remainingTextLength <= 0) break;
        const item = loadedConversation[index];
        const text = item.text.slice(0, Math.min(200_000, remainingTextLength));
        conversation.unshift({ ...item, text });
        remainingTextLength -= text.length;
      }
      return conversation;
    } catch {
      throw new Error('Could not load the full conversation. Try again.');
    }
  };

  return (
    <>
      {!open && <div className="mt-7 flex items-center gap-2">
        <button
          type="button"
          className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border/80 bg-background px-4 text-left text-sm text-muted-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-primary/35 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          disabled={!canReply}
          onClick={() => onOpenChange(true, 'reply')}
        >
          <Reply className="size-4 shrink-0 text-primary" />
          <span className="truncate">Write a reply…</span>
        </button>
        {canReplyAll && <Button
          variant="ghost"
          className="h-12 shrink-0 rounded-2xl border border-border/80 px-4 text-sm font-normal text-muted-foreground hover:border-primary/35 hover:text-foreground"
          onClick={() => onOpenChange(true, 'replyAll')}
        >
          <ReplyAll className="size-4 text-primary" />
          Reply all
        </Button>}
      </div>}
      <ComposeDialog
        open={open}
        accounts={[account]}
        defaultAccountId={account.id}
        composerKind="reply"
        variant="inline"
        title={mode === 'replyAll' ? 'Reply all' : 'Reply'}
        initialDraft={createReplyDraft(account, summary, message, signatureBody(account.id), mode)}
        loadConversation={loadConversation}
        onOpenChange={onOpenChange}
        onSent={(sentMessage) => { if (sentMessage) onSent(sentMessage); }}
        onDraftSaved={onDraftSaved}
        onDeleted={onDraftDeleted}
      />
    </>
  );
}
