import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  avatarColorClass,
  avatarInitials,
  hasRemoteImages,
  htmlDocument,
  safeAvatarUrl,
} from './mail-common';

describe('conversation avatars', () => {
  it('creates compact initials from names and email addresses', () => {
    expect(avatarInitials('Maya Chen')).toBe('MC');
    expect(avatarInitials('maya.chen@example.com')).toBe('MC');
    expect(avatarInitials('Support')).toBe('SU');
    expect(avatarInitials('')).toBe('?');
  });

  it('assigns a stable palette color for a sender', () => {
    expect(avatarColorClass('Maya Chen')).toBe(avatarColorClass('Maya Chen'));
    expect(avatarColorClass('Maya Chen')).toMatch(/^bg-/);
  });

  it('allows cached raster data but rejects remote and SVG avatar sources', () => {
    expect(safeAvatarUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    expect(safeAvatarUrl('https://tracking.example/avatar.png')).toBeNull();
    expect(safeAvatarUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
  });
});

describe('HTML email documents', () => {
  it('allows the opted-in iframe policy through the inherited app-shell CSP', () => {
    const appShell = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

    expect(appShell).toMatch(/img-src [^;]*http: [^;]*https:/);
  });

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
    expect(blocked).toContain("type:'emzero:open-link'");
    expect(blocked).toContain("script-src 'sha256-WjIlQhU8kgACo60V/0qpiNd4Brn6ImW1j3ghP53B1Yg='");
  });
});
