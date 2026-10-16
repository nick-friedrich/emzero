import { describe, expect, it } from 'vitest';
import type { MailMessageSummary } from '../../shared/accounts';
import { optimisticPatches, patchConversation, patchMessage } from './conversation-patches';

function message(uid: number, overrides: Partial<MailMessageSummary> = {}): MailMessageSummary {
  return {
    uid,
    folderPath: 'INBOX',
    unread: true,
    flagged: false,
    important: false,
    dueDate: null,
    color: null,
    ...overrides,
  } as MailMessageSummary;
}

describe('optimisticPatches', () => {
  it('marks messages read and restores their previous values', () => {
    const messages = [message(1), message(2, { unread: false })];
    const patches = optimisticPatches(messages, 'read');
    expect(patches).not.toBeNull();
    expect(messages.map((item) => patchMessage(item, patches!.apply).unread)).toEqual([false, false]);
    expect(messages.map((item) => patchMessage(item, patches!.revert).unread)).toEqual([true, false]);
  });

  it('only touches the fields the action changes', () => {
    const patches = optimisticPatches([message(1, { color: 'red' })], 'star');
    expect(patches!.apply.get('INBOX:1')).toEqual({ flagged: true });
    expect(patches!.revert.get('INBOX:1')).toEqual({ flagged: false });
  });

  it('sets a due date when marking important and clears it when unmarking', () => {
    const marked = optimisticPatches([message(1)], 'mark-important', { dueDate: '2026-10-20' });
    expect(marked!.apply.get('INBOX:1')).toEqual({ important: true, dueDate: '2026-10-20' });
    const cleared = optimisticPatches([message(1, { important: true, dueDate: '2026-10-20' })], 'clear-important');
    expect(cleared!.apply.get('INBOX:1')).toEqual({ important: false, dueDate: null });
    expect(cleared!.revert.get('INBOX:1')).toEqual({ important: true, dueDate: '2026-10-20' });
  });

  it('returns null for actions that remove messages', () => {
    expect(optimisticPatches([message(1)], 'delete')).toBeNull();
    expect(optimisticPatches([message(1)], 'move')).toBeNull();
  });

  it('patches only matching messages in a conversation', () => {
    const conversation = { id: 'c', subject: 'Hi', messages: [message(1), message(2, { folderPath: 'Sent' })] };
    const patches = optimisticPatches([conversation.messages[0]], 'read')!;
    const next = patchConversation(conversation as never, patches.apply);
    expect(next.messages.map((item) => item.unread)).toEqual([false, true]);
  });
});
