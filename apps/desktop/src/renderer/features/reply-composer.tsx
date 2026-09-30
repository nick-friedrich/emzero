import type { AccountSummary, MailMessageDetail, MailMessageSummary } from '../../shared/accounts';
import type { AiConversationMessage } from '../../shared/ai';
import { createReplyDraft, replyRecipients } from '../../shared/replies';
import { ComposeDialog, type DraftDeletedEvent, type DraftSavedEvent } from './compose-dialog';
import { signatureBody } from './signatures';
import { Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ReplyComposer({
  account,
  summary,
  message,
  threadMessages,
  open,
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
  onOpenChange: (open: boolean) => void;
  onSent: (message: MailMessageSummary) => void;
  onDraftSaved?: (event: DraftSavedEvent) => void;
  onDraftDeleted?: (event: DraftDeletedEvent) => void;
}) {
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
      {!open && <Button variant="ghost"
        className="mt-7 h-14 w-full justify-start gap-3 rounded-xl border border-border/70 bg-background px-4 text-sm font-normal text-muted-foreground hover:border-primary/30"
        disabled={replyRecipients(account, message).length === 0}
        onClick={() => onOpenChange(true)}>
        <Reply className="size-4 text-primary" />
        Write a reply…
      </Button>}
      <ComposeDialog
        open={open}
        accounts={[account]}
        defaultAccountId={account.id}
        composerKind="reply"
        variant="inline"
        initialDraft={createReplyDraft(account, summary, message, signatureBody(account.id))}
        loadConversation={loadConversation}
        onOpenChange={onOpenChange}
        onSent={(sentMessage) => { if (sentMessage) onSent(sentMessage); }}
        onDraftSaved={onDraftSaved}
        onDeleted={onDraftDeleted}
      />
    </>
  );
}
