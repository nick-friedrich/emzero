import { describe, expect, it } from 'vitest';
import type { MailMessageSummary } from '../../shared/accounts';
import type { MailConversation } from '../../shared/conversations';
import { applyInboxView } from './inbox-view-options';

function conversation(
  id: string,
  sentAt: string,
  {
    unread = false,
    flagged = false,
    relatedUnread = false,
    dueDate = null,
  }: { unread?: boolean; flagged?: boolean; relatedUnread?: boolean; dueDate?: string | null } = {},
): MailConversation {
  const message = (folderPath: string, values: Partial<MailMessageSummary>): MailMessageSummary => ({
    folderPath,
    uid: id.charCodeAt(0),
    messageId: `<${id}@example.com>`,
    inReplyTo: null,
    references: [],
    subject: id,
    from: [],
    to: [],
    sentAt,
    receivedAt: null,
    unread: false,
    flagged: false,
    important: false,
    dueDate: null,
    color: null,
    size: null,
    ...values,
  });
  return {
    id,
    subject: id,
    messages: [
      message('INBOX', { unread, flagged, important: dueDate !== null, dueDate }),
      ...(relatedUnread ? [message('Sent', { unread: true })] : []),
    ],
  };
}

describe('inbox view options', () => {
  const newestRead = conversation('newest', '2026-08-30T12:00:00.000Z');
  const olderUnread = conversation('unread', '2026-08-29T12:00:00.000Z', { unread: true });
  const oldestStarred = conversation('starred', '2026-08-28T12:00:00.000Z', { flagged: true });

  it('filters unread and starred conversations in the inbox folder', () => {
    expect(applyInboxView([newestRead, olderUnread, oldestStarred], 'INBOX', 'unread'))
      .toEqual([olderUnread]);
    expect(applyInboxView([newestRead, olderUnread, oldestStarred], 'INBOX', 'starred'))
      .toEqual([oldestStarred]);
  });

  it('groups starred and unread conversations above the remaining mail', () => {
    expect(applyInboxView([newestRead, oldestStarred, olderUnread], 'INBOX', 'all'))
      .toEqual([oldestStarred, olderUnread, newestRead]);
  });

  it('does not treat unread messages in related folders as unread inbox mail', () => {
    const relatedUnread = conversation('related', '2026-08-30T13:00:00.000Z', {
      relatedUnread: true,
    });
    expect(applyInboxView([relatedUnread], 'INBOX', 'unread')).toEqual([]);
  });

  it('shows only conversations with a due date, soonest first', () => {
    const dueLater = conversation('later', '2026-08-30T12:00:00.000Z', { dueDate: '2026-09-10' });
    const overdue = conversation('overdue', '2026-08-20T12:00:00.000Z', { dueDate: '2026-08-25' });
    expect(applyInboxView([newestRead, dueLater, olderUnread, overdue], 'INBOX', 'due'))
      .toEqual([overdue, dueLater]);
  });
});
