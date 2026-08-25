import { describe, expect, it } from 'vitest';
import { findDraftsFolder } from './mail-drafts.js';

describe('draft folder discovery', () => {
  it('uses a selectable provider-designated Drafts folder', () => {
    expect(
      findDraftsFolder([
        { path: 'INBOX', specialUse: '\\Inbox', flags: new Set<string>() },
        { path: 'Drafts', specialUse: '\\Drafts', flags: new Set<string>() },
      ]),
    ).toBe('Drafts');
  });

  it('rejects missing and non-selectable Drafts folders', () => {
    expect(
      findDraftsFolder([
        { path: 'Drafts', specialUse: '\\Drafts', flags: new Set(['\\Noselect']) },
      ]),
    ).toBeNull();
    expect(findDraftsFolder([])).toBeNull();
  });
});
