import { describe, expect, it } from 'vitest';
import type { AccountSummary, MailMessageDetail, MailMessageSummary } from './accounts.js';
import {
  accountAddresses,
  matchingAlias,
  sendingIdentity,
  storedAliases,
  validateAliases,
} from './aliases.js';
import { createReplyDraft, replyAllCcRecipients, replyRecipients } from './replies.js';

const account: AccountSummary = {
  id: 'account-1',
  name: 'Nick',
  email: 'nick@icloud.com',
  username: 'nick@icloud.com',
  imap: { host: 'imap.mail.me.com', port: 993, secure: true },
  smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
  authentication: 'password',
  createdAt: '2026-01-01T00:00:00.000Z',
  color: 'blue',
  aliases: [
    { address: 'hello@example.dev', name: '' },
    { address: 'Support@Example.dev', name: 'Example Support' },
  ],
};

describe('sending identity', () => {
  it('sends from the account address by default', () => {
    expect(sendingIdentity(account)).toEqual({ name: 'Nick', address: 'nick@icloud.com' });
    expect(sendingIdentity(account, 'NICK@icloud.com')).toEqual({ name: 'Nick', address: 'nick@icloud.com' });
  });

  it('sends as an alias with its own or the account name', () => {
    expect(sendingIdentity(account, 'hello@example.dev')).toEqual({ name: 'Nick', address: 'hello@example.dev' });
    expect(sendingIdentity(account, 'support@example.dev'))
      .toEqual({ name: 'Example Support', address: 'Support@Example.dev' });
  });

  it('refuses addresses that do not belong to the account', () => {
    expect(sendingIdentity(account, 'someone@else.dev')).toBeNull();
  });

  it('lists every own address in lowercase', () => {
    expect([...accountAddresses(account)]).toEqual([
      'nick@icloud.com',
      'hello@example.dev',
      'support@example.dev',
    ]);
  });
});

describe('alias validation', () => {
  it('trims and keeps valid aliases', () => {
    expect(validateAliases([{ address: ' a@example.dev ', name: ' A ' }], account.email))
      .toEqual({ aliases: [{ address: 'a@example.dev', name: 'A' }] });
  });

  it('rejects invalid, duplicate, and primary addresses', () => {
    expect(validateAliases([{ address: 'not-an-email', name: '' }], account.email)).toHaveProperty('error');
    expect(validateAliases([{ address: 'a@example.dev\r\nBcc: x@y.z', name: '' }], account.email)).toHaveProperty('error');
    expect(validateAliases([{ address: 'Nick@iCloud.com', name: '' }], account.email)).toHaveProperty('error');
    expect(validateAliases([
      { address: 'a@example.dev', name: '' },
      { address: 'A@example.dev', name: '' },
    ], account.email)).toHaveProperty('error');
    expect(validateAliases([{ address: 'a@example.dev', name: 'Bad\nName' }], account.email)).toHaveProperty('error');
  });

  it('drops malformed stored entries instead of failing', () => {
    expect(storedAliases(undefined, account.email)).toEqual([]);
    expect(storedAliases([
      { address: 'a@example.dev', name: 'A' },
      { address: 'broken' },
      'junk',
      { address: 'A@example.dev', name: '' },
    ], account.email)).toEqual([{ address: 'a@example.dev', name: 'A' }]);
  });
});

describe('replies to alias mail', () => {
  const summary: MailMessageSummary = {
    folderPath: 'INBOX',
    uid: 1,
    messageId: '<m@example.com>',
    inReplyTo: null,
    references: [],
    subject: 'Hi',
    from: [{ name: 'Sender', address: 'sender@example.com' }],
    to: [],
    sentAt: null,
    receivedAt: null,
    unread: false,
    flagged: false,
    important: false,
    dueDate: null,
    color: null,
    size: 1,
  };
  const detail = (to: MailMessageDetail['to'], cc: MailMessageDetail['cc'] = []): MailMessageDetail => ({
    uid: 1,
    messageId: '<m@example.com>',
    subject: 'Hi',
    from: [{ name: 'Sender', address: 'sender@example.com' }],
    to,
    cc,
    replyTo: [],
    sentAt: null,
    text: 'Hi',
    html: null,
    htmlHasQuotedText: false,
    attachments: [],
  } as MailMessageDetail);

  it('replies from the alias the message was sent to', () => {
    const message = detail([{ name: null, address: 'support@example.dev' }]);
    expect(createReplyDraft(account, summary, message, '').from).toBe('Support@Example.dev');
  });

  it('replies from the account when the message reached its own address first', () => {
    const message = detail([{ name: null, address: 'nick@icloud.com' }], [{ name: null, address: 'hello@example.dev' }]);
    expect(createReplyDraft(account, summary, message, '')).not.toHaveProperty('from');
    expect(matchingAlias(account, [{ name: null, address: 'other@example.com' }])).toBeUndefined();
  });

  it('never addresses a reply to the account\'s own aliases', () => {
    const ownSent = {
      ...detail([{ name: null, address: 'friend@example.com' }], [{ name: null, address: 'hello@example.dev' }]),
      from: [{ name: 'Nick', address: 'support@example.dev' }],
    };
    expect(replyRecipients(account, ownSent)).toEqual([{ name: null, address: 'friend@example.com' }]);
    expect(replyAllCcRecipients(account, ownSent)).toEqual([]);
  });
});
