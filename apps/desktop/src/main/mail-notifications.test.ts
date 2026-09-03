import { describe, expect, it } from 'vitest';
import type { MailMessageSummary } from '../shared/accounts.js';
import { newMailNotification, newlyArrivedUnreadMessages } from './mail-notifications.js';

function message(
  uid: number,
  unread = true,
  from: MailMessageSummary['from'] = [{ name: 'Ada Lovelace', address: 'ada@example.com' }],
): MailMessageSummary {
  return {
    folderPath: 'INBOX',
    uid,
    messageId: `<${uid}@example.com>`,
    inReplyTo: null,
    references: [],
    subject: `Message ${uid}`,
    from,
    to: [],
    sentAt: '2026-08-30T12:00:00.000Z',
    receivedAt: '2026-08-30T12:00:00.000Z',
    unread,
    flagged: false,
    important: false,
    dueDate: null,
    color: null,
    size: 100,
  };
}

describe('new mail detection', () => {
  it('returns only newly cached unread messages after an established sync', () => {
    expect(newlyArrivedUnreadMessages(
      [message(1), message(2)],
      '2026-08-30T11:55:00.000Z',
      '100',
      [message(1), message(2), message(3), message(4, false)],
      '100',
    )).toEqual([message(3)]);
  });

  it('stays quiet during initial hydration and UID validity resets', () => {
    expect(newlyArrivedUnreadMessages([], null, null, [message(1)], '100')).toEqual([]);
    expect(newlyArrivedUnreadMessages([message(1)], '2026-08-30T11:55:00.000Z', '100', [message(2)], '200')).toEqual([]);
  });
});

describe('notification content', () => {
  it('shows sender and subject for one message', () => {
    expect(newMailNotification('Personal', [message(3)])).toEqual({
      title: 'New mail from Ada Lovelace',
      body: 'Message 3',
      subtitle: 'Personal',
    });
  });

  it('collapses multiple messages into one account summary', () => {
    expect(newMailNotification('Work', [message(3), message(4)])).toEqual({
      title: '2 new messages',
      body: 'Work',
      subtitle: 'Work',
    });
  });
});
