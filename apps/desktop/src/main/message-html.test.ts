import { describe, expect, it } from 'vitest';
import { hasQuotedHtml, sanitizedMessageHtml } from './message-html.js';

describe('sanitizedMessageHtml', () => {
  it('removes active content while retaining safe web links', () => {
    const result = sanitizedMessageHtml(`
      <script>alert('xss')</script>
      <form action="https://attacker.example"><input name="secret"></form>
      <a href="https://attacker.example" onclick="steal()">safe label</a>
      <a href="javascript:steal()">unsafe link</a>
      <p onmouseover="steal()">message</p>
    `);

    expect(result).not.toMatch(/script|onclick|onmouseover|form|input|javascript/i);
    expect(result).toContain('href="https://attacker.example"');
    expect(result).toContain('safe label');
    expect(result).toContain('message');
  });

  it('retains safe image sources for renderer-level privacy controls', () => {
    const result = sanitizedMessageHtml(`
      <img src="https://tracker.example/open.gif" alt="tracker">
      <img src="http://images.example/banner.png" alt="banner">
      <img src="data:image/png;base64,AA==" alt="embedded">
      <img src="javascript:alert(1)" alt="unsafe">
    `);

    expect(result).toContain('https://tracker.example/open.gif');
    expect(result).toContain('http://images.example/banner.png');
    expect(result).toContain('data:image/png;base64,AA==');
    expect(result).not.toContain('javascript:');
  });

  it('keeps a constrained subset of useful email styling', () => {
    const result = sanitizedMessageHtml(
      '<p style="color:#123456;font-weight:bold;position:fixed;background-image:url(https://tracker.example)">Styled</p>',
    );

    expect(result).toContain('color:#123456');
    expect(result).toContain('font-weight:bold');
    expect(result).not.toMatch(/position|background-image|tracker/i);
  });

  it('repairs double-escaped legacy webmail formatting', () => {
    const result = sanitizedMessageHtml(
      '&lt;font color=&quot;#6d6e71&quot;&gt;Customer: 123&lt;br /&gt;Reference: 456&lt;/font&gt;',
    );

    expect(result).not.toContain('&lt;font');
    expect(result).not.toContain('&lt;br');
    expect(result).toContain('Customer: 123<br />Reference: 456');
  });

  it('recognizes common quoted-reply containers', () => {
    expect(hasQuotedHtml('<blockquote type="cite">previous</blockquote>')).toBe(true);
    expect(hasQuotedHtml('<div class="gmail_quote">previous</div>')).toBe(true);
    expect(hasQuotedHtml('<blockquote>previous</blockquote>')).toBe(true);
  });
});
