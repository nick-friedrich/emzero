import { describe, expect, it } from 'vitest';
import type { AccountSummary, MailMessageDetail, MailMessageSummary } from './accounts.js';
import { createReplyDraft, replyRecipients, replySubject, validateReplyDraft } from './replies.js';

const account: AccountSummary = {
  id: 'account-1',
  name: 'Personal',
  email: 'me@example.com',
  username: 'me@example.com',
  imap: { host: 'imap.example.com', port: 993, secure: true },
  smtp: { host: 'smtp.example.com', port: 465, secure: true },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const detail: MailMessageDetail = {
  uid: 7,
  messageId: '<message@example.com>',
  subject: 'Hello',
  from: [{ name: 'Sender', address: 'sender@example.com' }],
  to: [{ name: 'Me', address: 'me@example.com' }],
  cc: [],
  replyTo: [],
  sentAt: null,
  text: 'Original',
  html: null,
  htmlHasQuotedText: false,
  attachments: [],
};

const summary: MailMessageSummary = {
  folderPath: 'INBOX',
  uid: 7,
  messageId: '<message@example.com>',
  inReplyTo: '<root@example.com>',
  references: ['<root@example.com>'],
  subject: 'Hello',
  from: detail.from,
  to: detail.to,
  sentAt: null,
  receivedAt: null,
  unread: false,
  flagged: false,
  size: null,
};

describe('reply helpers', () => {
  it('adds one reply prefix without stacking prefixes', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
  });

  it('prefers Reply-To and excludes the account identity', () => {
    expect(
      replyRecipients(account, {
        ...detail,
        replyTo: [
          { name: 'Replies', address: 'reply@example.com' },
          { name: 'Me', address: 'me@example.com' },
        ],
      }),
    ).toEqual([{ name: 'Replies', address: 'reply@example.com' }]);
  });

  it('replies to recipients when the selected message was sent by this account', () => {
    expect(
      replyRecipients(account, {
        ...detail,
        from: [{ name: 'Me', address: 'me@example.com' }],
        to: [{ name: 'Sender', address: 'sender@example.com' }],
      }),
    ).toEqual([{ name: 'Sender', address: 'sender@example.com' }]);
  });

  it('builds threading headers and validates the body', () => {
    const draft = createReplyDraft(account, summary, detail, 'Thanks!');
    expect(draft).toMatchObject({
      subject: 'Re: Hello',
      inReplyTo: '<message@example.com>',
      references: ['<root@example.com>', '<message@example.com>'],
    });
    expect(validateReplyDraft(draft)).toBeNull();
    expect(validateReplyDraft({ ...draft, text: '   ' })).toBe('Write a message before sending.');
  });
});
