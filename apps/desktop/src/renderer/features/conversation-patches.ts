import type { MailMessageSummary } from '../../shared/accounts';
import type { MailConversation } from '../../shared/conversations';
import { tomorrowDateKey, type EmzeroMessageColor } from '../../shared/message-keywords';
import type { ConversationAction } from './mail-common';

/** The message fields a single-conversation action changes optimistically. */
export type MessagePatch = Partial<Pick<MailMessageSummary, 'unread' | 'flagged' | 'important' | 'dueDate' | 'color'>>;

/** Patches keyed by `folderPath:uid`. */
export type MessagePatches = ReadonlyMap<string, MessagePatch>;

export function messageKey(message: Pick<MailMessageSummary, 'folderPath' | 'uid'>): string {
  return `${message.folderPath}:${message.uid}`;
}

function actionPatch(
  action: ConversationAction,
  metadata?: { dueDate?: string; color?: EmzeroMessageColor | null },
): MessagePatch | null {
  switch (action) {
    case 'read':
    case 'unread':
      return { unread: action === 'unread' };
    case 'star':
    case 'unstar':
      return { flagged: action === 'star' };
    case 'mark-important':
      return { important: true, dueDate: metadata?.dueDate ?? tomorrowDateKey() };
    case 'clear-important':
      return { important: false, dueDate: null };
    case 'set-color':
      return { color: metadata?.color ?? null };
    case 'clear-color':
      return { color: null };
    default:
      return null;
  }
}

/**
 * The optimistic change an action makes to `messages`, and the patch that puts
 * back their previous values if the server rejects it. Returns null for actions
 * such as delete and move that remove messages instead of changing them.
 */
export function optimisticPatches(
  messages: readonly MailMessageSummary[],
  action: ConversationAction,
  metadata?: { dueDate?: string; color?: EmzeroMessageColor | null },
): { apply: MessagePatches; revert: MessagePatches } | null {
  const patch = actionPatch(action, metadata);
  if (!patch) return null;
  const fields = Object.keys(patch) as (keyof MessagePatch)[];
  return {
    apply: new Map(messages.map((message) => [messageKey(message), patch])),
    revert: new Map(messages.map((message) => [
      messageKey(message),
      Object.fromEntries(fields.map((field) => [field, message[field]])) as MessagePatch,
    ])),
  };
}

export function patchMessage(message: MailMessageSummary, patches: MessagePatches): MailMessageSummary {
  const patch = patches.get(messageKey(message));
  return patch ? { ...message, ...patch } : message;
}

export function patchConversation(conversation: MailConversation, patches: MessagePatches): MailConversation {
  return { ...conversation, messages: conversation.messages.map((message) => patchMessage(message, patches)) };
}
