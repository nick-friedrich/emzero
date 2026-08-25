import { describe, expect, it } from 'vitest';
import type { MailFolderSummary } from '../shared/accounts.js';
import {
  appendableFlags,
  findMoveDestination,
  validMessageUids,
} from './message-actions.js';

const folder = (
  path: string,
  specialUse: string | null = null,
  selectable = true,
): MailFolderSummary => ({
  path,
  name: path,
  parentPath: '',
  delimiter: '/',
  specialUse,
  selectable,
  unreadCount: 0,
});

describe('message action helpers', () => {
  it('validates non-empty positive integer UID lists', () => {
    expect(validMessageUids([1, 2, 3])).toBe(true);
    expect(validMessageUids([])).toBe(false);
    expect(validMessageUids([0])).toBe(false);
    expect(validMessageUids([1.5])).toBe(false);
    expect(validMessageUids('1')).toBe(false);
  });

  it('selects only valid, different move destinations', () => {
    const folders = [folder('INBOX', '\\Inbox'), folder('Archive', '\\Archive'), folder('Group', null, false)];
    expect(findMoveDestination(folders, 'INBOX', 'archive')?.path).toBe('Archive');
    expect(findMoveDestination(folders, 'Archive', 'archive')).toBeUndefined();
    expect(findMoveDestination(folders, 'INBOX', 'move', 'Group')).toBeUndefined();
  });

  it('preserves only portable system flags during cross-account transfers', () => {
    expect(
      appendableFlags(new Set(['\\Seen', '\\Answered', '\\Flagged', '\\Draft', '$Custom'])),
    ).toEqual(['\\Seen', '\\Answered', '\\Flagged', '\\Draft']);
  });
});
