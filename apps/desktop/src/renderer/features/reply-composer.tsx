import type { AccountSummary, MailMessageDetail, MailMessageSummary } from '../../shared/accounts';
import type { AiConversationMessage } from '../../shared/ai';
import { createReplyDraft } from '../../shared/replies';
import { ComposeDialog, type DraftDeletedEvent, type DraftSavedEvent } from './compose-dialog';
import { signatureBody } from './signatures';

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
    <ComposeDialog
      open={open}
      accounts={[account]}
      defaultAccountId={account.id}
      composerKind="reply"
      initialDraft={createReplyDraft(account, summary, message, signatureBody(account.id))}
      loadConversation={loadConversation}
      onOpenChange={onOpenChange}
      onSent={(sentMessage) => { if (sentMessage) onSent(sentMessage); }}
      onDraftSaved={onDraftSaved}
      onDeleted={onDraftDeleted}
    />
  );
}
