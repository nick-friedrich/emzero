import { describe, expect, it } from 'vitest';
import { normalizedLink, pastedFormatting, plainFormatting } from './clipboard-html';

describe('pasted formatting', () => {
  it('ignores the normal-weight bold wrapper Google Docs puts around pasted text', () => {
    expect(pastedFormatting('B', 'font-weight:normal;', plainFormatting).bold).toBe(false);
    expect(pastedFormatting('B', 'font-weight: 400', plainFormatting).bold).toBe(false);
  });

  it('reads bold, italic, underline, and strikethrough from inline styles', () => {
    expect(pastedFormatting('SPAN', 'font-weight:700;font-style:italic', plainFormatting)).toEqual({
      bold: true, italic: true, underline: false, strike: false,
    });
    expect(pastedFormatting('SPAN', 'text-decoration: underline line-through', plainFormatting)).toMatchObject({
      underline: true, strike: true,
    });
  });

  it('keeps semantic tags and inherited formatting', () => {
    expect(pastedFormatting('STRONG', '', plainFormatting).bold).toBe(true);
    expect(pastedFormatting('EM', '', plainFormatting).italic).toBe(true);
    expect(pastedFormatting('SPAN', '', { ...plainFormatting, bold: true }).bold).toBe(true);
    expect(pastedFormatting('SPAN', 'font-weight: normal', { ...plainFormatting, bold: true }).bold).toBe(false);
  });
});

describe('link targets', () => {
  it('completes bare domains and email addresses', () => {
    expect(normalizedLink('example.com/path')).toBe('https://example.com/path');
    expect(normalizedLink('maya@example.com')).toBe('mailto:maya@example.com');
    expect(normalizedLink(' https://example.com ')).toBe('https://example.com');
  });

  it('rejects unsafe or incomplete targets', () => {
    expect(normalizedLink('javascript:alert(1)')).toBeNull();
    expect(normalizedLink('not a link')).toBeNull();
    expect(normalizedLink('localhost')).toBeNull();
  });
});
