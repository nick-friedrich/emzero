import { describe, expect, it } from 'vitest';
import { delimitedText, messageHtml, signatureHtml } from './signature-html';

describe('signature markup', () => {
  it('wraps the signature in the Outlook-style Signature block without a visible divider', () => {
    expect(signatureHtml('Nick\nEmzero')).toBe('<div id="Signature">Nick<br>Emzero</div>');
    expect(signatureHtml('')).toBe('');
  });

  it('turns a delimited plain-text signature into the HTML block', () => {
    expect(messageHtml('Hello\n\n-- \nNick', 'Nick')).toBe('Hello<br><br><div id="Signature">Nick</div>');
    expect(messageHtml('\n\n-- \nNick', 'Nick')).toBe('<br><br><div id="Signature">Nick</div>');
    expect(messageHtml('Hello', 'Nick')).toBe('Hello');
  });

  it('keeps the RFC 3676 delimiter in the plain-text part', () => {
    expect(delimitedText('Hello\n\n\nNick\nEmzero\n', 'Nick\nEmzero')).toBe('Hello\n\n-- \nNick\nEmzero');
    expect(delimitedText('\n\nNick', 'Nick')).toBe('\n\n-- \nNick');
    expect(delimitedText('Hello', '')).toBe('Hello');
  });
});
