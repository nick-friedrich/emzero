import { describe, expect, it } from 'vitest';
import type { MailMessageDetail } from '../../shared/accounts';
import { formatConversationForCopy } from './conversation-copy';

const base: MailMessageDetail = {
  uid: 1,
  messageId: null,
  subject: 'Project update',
  from: [{ name: 'Alice', address: 'alice@example.com' }],
  to: [{ name: null, address: 'bob@example.com' }],
  cc: [],
  replyTo: [],
  sentAt: '2026-09-26T09:00:00.000Z',
  text: 'First message',
  html: null,
  htmlHasQuotedText: false,
  attachments: [],
};

describe('copy conversation text', () => {
  it('includes every message with headers and full body in the provided order', () => {
    const result = formatConversationForCopy('Project update', [
      base,
      { ...base, uid: 2, text: 'Second message\n> Prior message', attachments: [
        { filename: 'notes.pdf', contentType: 'application/pdf', size: 123, related: false },
        { filename: 'inline.png', contentType: 'image/png', size: 45, related: true },
      ] },
    ]);
    expect(result.indexOf('First message')).toBeLessThan(result.indexOf('Second message'));
    expect(result).toContain('From: Alice <alice@example.com>');
    expect(result).toContain('Date: 2026-09-26T09:00:00.000Z');
    expect(result).toContain('Second message\n> Prior message');
    expect(result).toContain('Attachments (files not included): notes.pdf');
    expect(result).not.toContain('inline.png');
  });
});
