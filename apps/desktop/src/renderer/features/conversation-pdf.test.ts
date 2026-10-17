import { describe, expect, it } from 'vitest';
import type { MailMessageDetail } from '../../shared/accounts';
import { conversationPdfDocument } from './conversation-pdf';

function message(overrides: Partial<MailMessageDetail> = {}): MailMessageDetail {
  return {
    uid: 1,
    messageId: null,
    subject: 'Quarterly plan',
    from: [{ name: 'Maya <Chen>', address: 'maya@example.com' }],
    to: [{ name: null, address: 'team@example.com' }],
    cc: [],
    replyTo: [],
    sentAt: '2026-03-04T10:00:00.000Z',
    text: 'Hello <team>\n\n> older text',
    html: null,
    htmlHasQuotedText: false,
    attachments: [],
    ...overrides,
  };
}

describe('conversation PDF document', () => {
  it('escapes headers and plain-text bodies', () => {
    const html = conversationPdfDocument('Plan <draft>', [message()], false);
    expect(html).toContain('<h1>Plan &#60;draft&#62;</h1>');
    expect(html).toContain('Maya &#60;Chen&#62;');
    expect(html).toContain('Hello &#60;team&#62;');
    expect(html).not.toContain('<team>');
  });

  it('keeps quoted history for a single message and hides it in threads', () => {
    expect(conversationPdfDocument('Plan', [message()], false)).toContain('older text');
    const thread = conversationPdfDocument('Plan', [message(), message({ uid: 2 })], false);
    expect(thread).not.toContain('older text');
    expect(thread).toContain('.body blockquote');
  });

  it('blocks scripts and only allows remote images when requested', () => {
    const blocked = conversationPdfDocument('Plan', [message({ html: '<p>Hi</p>' })], false);
    expect(blocked).toContain("default-src 'none'; img-src data:;");
    expect(blocked).not.toContain('script-src');
    expect(blocked).toContain('<div class="body"><p>Hi</p></div>');
    expect(conversationPdfDocument('Plan', [message()], true)).toContain('img-src data: http: https:;');
  });

  it('lists only real attachments', () => {
    const html = conversationPdfDocument('Plan', [message({
      attachments: [
        { filename: 'report.pdf', contentType: 'application/pdf', size: 10, related: false },
        { filename: 'logo.png', contentType: 'image/png', size: 10, related: true },
      ],
    })], false);
    expect(html).toContain('report.pdf');
    expect(html).not.toContain('logo.png');
  });
});
