import { describe, expect, it } from 'vitest';
import { hasQuotedHtml, sanitizedMessageHtml } from './message-html.js';

describe('sanitizedMessageHtml', () => {
  it('removes scripts, event handlers, forms, and navigable links', () => {
    const result = sanitizedMessageHtml(`
      <script>alert('xss')</script>
      <form action="https://attacker.example"><input name="secret"></form>
      <a href="https://attacker.example" onclick="steal()">safe label</a>
      <p onmouseover="steal()">message</p>
    `);

    expect(result).not.toMatch(/script|onclick|onmouseover|form|input|href/i);
    expect(result).toContain('safe label');
    expect(result).toContain('message');
  });

  it('blocks remote tracking pixels but retains embedded images', () => {
    const result = sanitizedMessageHtml(`
      <img src="https://tracker.example/open.gif" alt="tracker">
      <img src="data:image/png;base64,AA==" alt="embedded">
    `);

    expect(result).not.toContain('https://tracker.example');
    expect(result).toContain('data:image/png;base64,AA==');
  });

  it('keeps a constrained subset of useful email styling', () => {
    const result = sanitizedMessageHtml(
      '<p style="color:#123456;font-weight:bold;position:fixed;background-image:url(https://tracker.example)">Styled</p>',
    );

    expect(result).toContain('color:#123456');
    expect(result).toContain('font-weight:bold');
    expect(result).not.toMatch(/position|background-image|tracker/i);
  });

  it('recognizes common quoted-reply containers', () => {
    expect(hasQuotedHtml('<blockquote type="cite">previous</blockquote>')).toBe(true);
    expect(hasQuotedHtml('<div class="gmail_quote">previous</div>')).toBe(true);
    expect(hasQuotedHtml('<blockquote>previous</blockquote>')).toBe(true);
  });
});
