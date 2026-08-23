import { describe, expect, it } from 'vitest';
import type { MailMessageSummary } from './accounts.js';
import {
  groupMessagesIntoConversations,
  normalizedSubject,
  splitQuotedText,
} from './conversations.js';

function message(
  uid: number,
  overrides: Partial<MailMessageSummary> = {},
): MailMessageSummary {
  return {
    uid,
    messageId: `<${uid}@example.com>`,
    inReplyTo: null,
    references: [],
    subject: 'Project update',
    from: [],
    to: [],
    sentAt: `2026-08-${String(uid).padStart(2, '0')}T12:00:00.000Z`,
    receivedAt: null,
    unread: false,
    flagged: false,
    size: 100,
    ...overrides,
  };
}

describe('groupMessagesIntoConversations', () => {
  it('groups a reply chain by Message-ID references and orders it oldest first', () => {
    const root = message(1);
    const reply = message(2, {
      subject: 'Re: Project update',
      inReplyTo: root.messageId,
      references: [root.messageId!],
    });
    const laterReply = message(3, {
      subject: 'Re: Project update',
      inReplyTo: reply.messageId,
      references: [root.messageId!, reply.messageId!],
    });

    const conversations = groupMessagesIntoConversations([laterReply, root, reply]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages.map(({ uid }) => uid)).toEqual([1, 2, 3]);
    expect(conversations[0].subject).toBe('Project update');
  });

  it('does not merge unrelated messages merely because subjects match', () => {
    expect(groupMessagesIntoConversations([message(1), message(2)])).toHaveLength(2);
  });
});

describe('reply presentation helpers', () => {
  it('removes repeated reply and forward prefixes', () => {
    expect(normalizedSubject(' Re: Fwd: RE: Project update ')).toBe('Project update');
  });

  it('separates common quoted reply text', () => {
    expect(splitQuotedText('Sounds good.\n\nOn Friday, Alex wrote:\n> Previous message')).toEqual({
      visible: 'Sounds good.',
      quoted: 'On Friday, Alex wrote:\n> Previous message',
    });
    expect(splitQuotedText('Confirmed.\n\nOn Friday, Alex\nwrote:\nPrevious message')).toEqual({
      visible: 'Confirmed.',
      quoted: 'On Friday, Alex\nwrote:\nPrevious message',
    });
  });
});
