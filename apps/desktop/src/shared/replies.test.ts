import { describe, expect, it } from 'vitest';
import type {
  AccountSummary,
  MailMessageDetail,
  MailMessageSummary,
  MailSendDraft,
} from './accounts.js';
import {
  createReplyDraft,
  parseAddressList,
  replyRecipients,
  replySubject,
  validateReplyDraft,
  validateSendDraft,
} from './replies.js';

const account: AccountSummary = {
  id: 'account-1',
  name: 'Personal',
  email: 'me@example.com',
  username: 'me@example.com',
  imap: { host: 'imap.example.com', port: 993, secure: true },
  smtp: { host: 'smtp.example.com', port: 465, secure: true },
  authentication: 'password',
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

describe('new message helpers', () => {
  const draft: MailSendDraft = {
    to: [{ name: null, address: 'person@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Hello',
    text: 'A new message',
    inReplyTo: null,
    references: [],
    attachments: [],
  };

  it('parses comma- and semicolon-separated recipients with optional names', () => {
    expect(parseAddressList('Jane Doe <jane@example.com>, other@example.com; third@example.com'))
      .toEqual([
        { name: 'Jane Doe', address: 'jane@example.com' },
        { name: null, address: 'other@example.com' },
        { name: null, address: 'third@example.com' },
      ]);
  });

  it('validates required fields and every recipient group', () => {
    expect(validateSendDraft(draft)).toBeNull();
    expect(validateSendDraft({ ...draft, to: [] })).toBe('Enter at least one recipient.');
    expect(
      validateSendDraft({ ...draft, cc: [{ name: null, address: 'not-an-address' }] }),
    ).toBe('Cc contains an invalid email address.');
    expect(validateSendDraft({ ...draft, subject: '' })).toBe('Enter a valid subject.');
    expect(
      validateSendDraft({
        ...draft,
        attachments: Array.from({ length: 21 }, (_, index) => ({
          id: `attachment-${index}`,
          filename: `${index}.txt`,
          size: 1,
        })),
      }),
    ).toBe('Attach no more than 20 files.');
    expect(
      validateSendDraft({
        ...draft,
        attachments: [{ id: 'large', filename: 'large.bin', size: 51 * 1024 * 1024 }],
      }),
    ).toBe('Attachments cannot exceed 50 MB in total.');
  });
});
