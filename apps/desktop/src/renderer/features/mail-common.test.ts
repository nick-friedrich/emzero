import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  avatarColorClass,
  avatarInitials,
  conversationRepliedByMe,
  hasRemoteImages,
  htmlDocument,
  safeAvatarUrl,
} from './mail-common';
import type { AccountSummary, MailMessageSummary } from '../../shared/accounts';

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

describe('replied conversations', () => {
  const account = { email: 'me@example.com', username: 'me@example.com' } as AccountSummary;
  const message = (from: string, folderPath: string, sentAt: string): MailMessageSummary => ({
    folderPath,
    uid: 1,
    messageId: null,
    inReplyTo: null,
    references: [],
    subject: 'Hello',
    from: [{ name: null, address: from }],
    to: [],
    sentAt,
    receivedAt: null,
    unread: false,
    flagged: false,
    important: false,
    dueDate: null,
    color: null,
    size: null,
  } as MailMessageSummary);
  const noDrafts = new Set<string>();

  it('marks a conversation whose newest message is our reply', () => {
    const messages = [
      message('ME@example.com', 'Sent', '2026-09-19T10:00:00Z'),
      message('maya@example.com', 'INBOX', '2026-09-19T09:00:00Z'),
    ];
    expect(conversationRepliedByMe(messages, account, noDrafts)).toBe(true);
  });

  it('clears the mark once the other side answers again', () => {
    const messages = [
      message('maya@example.com', 'INBOX', '2026-09-19T11:00:00Z'),
      message('me@example.com', 'Sent', '2026-09-19T10:00:00Z'),
      message('maya@example.com', 'INBOX', '2026-09-19T09:00:00Z'),
    ];
    expect(conversationRepliedByMe(messages, account, noDrafts)).toBe(false);
  });

  it('ignores unsent drafts and conversations we started alone', () => {
    const drafts = new Set(['Drafts']);
    expect(conversationRepliedByMe([
      message('me@example.com', 'Drafts', '2026-09-19T10:00:00Z'),
      message('maya@example.com', 'INBOX', '2026-09-19T09:00:00Z'),
    ], account, drafts)).toBe(false);
    expect(conversationRepliedByMe([
      message('me@example.com', 'Sent', '2026-09-19T10:00:00Z'),
    ], account, noDrafts)).toBe(false);
  });
});
