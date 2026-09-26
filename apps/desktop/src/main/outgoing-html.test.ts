import { describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { outgoingHtml } from './outgoing-html.js';

const image = 'data:image/png;base64,iVBORw0KGgo=';

describe('outgoing rich text', () => {
  it('keeps formatting and embeds a pasted image in the MIME message', async () => {
    const html = outgoingHtml(`<p><strong>Hello</strong><img src="${image}"></p>`);
    expect(html).toContain('<strong>Hello</strong>');
    const compiled = await nodemailer.createTransport({ streamTransport: true, buffer: true })
      .sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'Image', text: 'Hello', html, attachDataUrls: true });
    const parsed = await simpleParser(compiled.message);
    expect(compiled.message.toString()).toContain('Content-ID:');
    expect(parsed.html).toContain('data:image/png;base64,');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].related).toBe(true);
  });

  it('strips active content and remote images', () => {
    expect(outgoingHtml('<script>alert(1)</script><img src="https://example.com/track.png"><b>Hi</b>'))
      .toBe('<b>Hi</b>');
  });

  it('rejects oversized pasted images', () => {
    expect(() => outgoingHtml(`<img src="data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}">`))
      .toThrow('5 MB');
  });
});
