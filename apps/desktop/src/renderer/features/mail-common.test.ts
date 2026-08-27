import { describe, expect, it } from 'vitest';
import { hasRemoteImages, htmlDocument } from './mail-common';

describe('HTML email documents', () => {
  it('detects remote images but not embedded data images', () => {
    expect(hasRemoteImages('<img src="https://images.example/banner.png">')).toBe(true);
    expect(hasRemoteImages('<img src="//images.example/banner.png">')).toBe(true);
    expect(hasRemoteImages('<img src="data:image/png;base64,AA==">')).toBe(false);
  });

  it('blocks remote images until the user opts in', () => {
    const blocked = htmlDocument('<img src="https://images.example/banner.png">', false, 'catppuccin');
    const allowed = htmlDocument(
      '<img src="https://images.example/banner.png">',
      false,
      'catppuccin',
      true,
    );

    expect(blocked).toContain("img-src data:");
    expect(blocked).not.toContain("img-src data: http: https:");
    expect(allowed).toContain("img-src data: http: https:");
    expect(blocked).toContain('color-scheme:light');
    expect(blocked).toContain('background:#fff');
  });
});
