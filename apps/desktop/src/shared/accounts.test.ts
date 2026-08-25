import { describe, expect, it } from 'vitest';
import {
  accountUnreadCount,
  chunkMessageUids,
  defaultAccountName,
  displayFolderName,
  findArchiveFolder,
  findInboxFolder,
  folderMoveRequestForDrop,
  optimisticFolderMove,
  manageableFolder,
  orderedFolderTree,
  visibleFolderTree,
  type AccountDraft,
  type MailFolderSummary,
  validateAccountDraft,
} from './accounts.js';

const validDraft: AccountDraft = {
  name: 'Personal',
  email: 'hello@example.com',
  username: 'hello@example.com',
  password: 'secret',
  imap: { host: 'imap.example.com', port: 993, secure: true },
  smtp: { host: 'smtp.example.com', port: 465, secure: true },
};

describe('validateAccountDraft', () => {
  it('accepts a complete account', () => {
    expect(validateAccountDraft(validDraft)).toBeNull();
  });

  it('rejects invalid addresses and ports', () => {
    expect(validateAccountDraft({ ...validDraft, email: 'invalid' })).toMatch(/valid email/);
    expect(
      validateAccountDraft({ ...validDraft, imap: { ...validDraft.imap, port: 70_000 } }),
    ).toMatch(/valid IMAP port/);
  });
});

describe('defaultAccountName', () => {
  it('uses the trimmed email address', () => {
    expect(defaultAccountName('  hello@example.com ')).toBe('hello@example.com');
  });
});

describe('displayFolderName', () => {
  it('normalizes inbox capitalization without changing other provider folder names', () => {
    const inbox: MailFolderSummary = {
      path: 'INBOX',
      name: 'INBOX',
      parentPath: '',
      delimiter: '/',
      specialUse: '\\Inbox',
      selectable: true,
      unreadCount: 0,
    };
    expect(displayFolderName(inbox)).toBe('Inbox');
    expect(displayFolderName({ ...inbox, path: 'Receipts', name: 'RECEIPTS', specialUse: null })).toBe(
      'RECEIPTS',
    );
  });
});

describe('findInboxFolder', () => {
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

  it('prefers the provider-designated inbox', () => {
    const namedInbox = folder('INBOX');
    const designatedInbox = folder('Mail/Incoming', '\\Inbox');
    expect(findInboxFolder([namedInbox, designatedInbox])).toBe(designatedInbox);
  });

  it('falls back to a selectable folder named inbox', () => {
    const unavailableInbox = folder('INBOX', null, false);
    const selectableInbox = folder('Inbox');
    expect(findInboxFolder([unavailableInbox, selectableInbox])).toBe(selectableInbox);
  });
});

describe('findArchiveFolder', () => {
  it('only accepts a selectable provider-designated archive', () => {
    const folder = (path: string, specialUse: string | null, selectable = true): MailFolderSummary => ({
      path,
      name: path,
      parentPath: '',
      delimiter: '/',
      specialUse,
      selectable,
      unreadCount: 0,
    });
    const namedArchive = folder('Archive', null);
    const unavailableArchive = folder('All Mail', '\\Archive', false);
    const designatedArchive = folder('Saved', '\\Archive');

    expect(findArchiveFolder([namedArchive, unavailableArchive, designatedArchive]))
      .toBe(designatedArchive);
    expect(findArchiveFolder([namedArchive, unavailableArchive])).toBeUndefined();
  });
});

describe('accountUnreadCount', () => {
  it('excludes trash and unselectable folders from the account total', () => {
    const folder = (
      path: string,
      unreadCount: number,
      specialUse: string | null = null,
      selectable = true,
    ): MailFolderSummary => ({
      path,
      name: path,
      parentPath: '',
      delimiter: '/',
      specialUse,
      selectable,
      unreadCount,
    });

    expect(
      accountUnreadCount([
        folder('INBOX', 3, '\\Inbox'),
        folder('Receipts', 2),
        folder('Trash', 4, '\\Trash'),
        folder('Container', 8, null, false),
      ]),
    ).toBe(5);
  });
});

describe('folder organization', () => {
  const folder = (
    path: string,
    parentPath = '',
    specialUse: string | null = null,
  ): MailFolderSummary => ({
    path,
    name: path.split('/').at(-1)!,
    parentPath,
    delimiter: '/',
    specialUse,
    selectable: true,
    unreadCount: 0,
  });

  it('places descendants directly after their parents while retaining sibling order', () => {
    const inbox = folder('INBOX', '', '\\Inbox');
    const projects = folder('Projects');
    const receipts = folder('Receipts');
    const alpha = folder('Projects/Alpha', 'Projects');
    const notes = folder('Projects/Alpha/Notes', 'Projects/Alpha');

    expect(orderedFolderTree([inbox, projects, receipts, alpha, notes]).map(({ path }) => path))
      .toEqual(['INBOX', 'Projects', 'Projects/Alpha', 'Projects/Alpha/Notes', 'Receipts']);
  });

  it('only allows custom folders to be renamed, moved, or deleted', () => {
    expect(manageableFolder(folder('Projects'))).toBe(true);
    expect(manageableFolder(folder('INBOX', '', '\\Inbox'))).toBe(false);
  });

  it('translates edge, center, and root drops into hierarchy moves', () => {
    const projects = folder('Projects');
    const alpha = folder('Projects/Alpha', 'Projects');
    const beta = folder('Projects/Beta', 'Projects');
    const receipts = folder('Receipts');
    const folders = [projects, alpha, beta, receipts];

    expect(folderMoveRequestForDrop(folders, 'Receipts', 'Projects', 'inside')).toEqual({
      folderPath: 'Receipts',
      parentPath: 'Projects',
      beforePath: null,
    });
    expect(folderMoveRequestForDrop(folders, 'Projects/Beta', 'Projects/Alpha', 'before')).toEqual({
      folderPath: 'Projects/Beta',
      parentPath: 'Projects',
      beforePath: 'Projects/Alpha',
    });
    expect(folderMoveRequestForDrop(folders, 'Projects/Alpha', null, 'root')).toEqual({
      folderPath: 'Projects/Alpha',
      parentPath: '',
      beforePath: null,
    });
    expect(folderMoveRequestForDrop(folders, 'Projects', 'Projects/Alpha', 'inside')).toBeNull();
  });

  it('optimistically moves a folder subtree and retains the requested sibling position', () => {
    const projects = folder('Projects');
    const alpha = folder('Projects/Alpha', 'Projects');
    const notes = folder('Projects/Alpha/Notes', 'Projects/Alpha');
    const receipts = folder('Receipts');
    const invoices = folder('Invoices');

    const moved = optimisticFolderMove(
      [projects, alpha, notes, receipts, invoices],
      { folderPath: 'Projects/Alpha', parentPath: '', beforePath: 'Invoices' },
    );

    expect(moved).not.toBeNull();
    expect(orderedFolderTree(moved!).map(({ path }) => path)).toEqual([
      'Projects',
      'Receipts',
      'Alpha',
      'Alpha/Notes',
      'Invoices',
    ]);
    expect(moved?.find(({ path }) => path === 'Alpha/Notes')?.parentPath).toBe('Alpha');
  });

  it('hides every descendant of a collapsed folder', () => {
    const projects = folder('Projects');
    const alpha = folder('Projects/Alpha', 'Projects');
    const notes = folder('Projects/Alpha/Notes', 'Projects/Alpha');
    const receipts = folder('Receipts');

    expect(
      visibleFolderTree(
        [projects, alpha, notes, receipts],
        new Set(['Projects']),
      ).map(({ path }) => path),
    ).toEqual(['Projects', 'Receipts']);
    expect(
      visibleFolderTree(
        [projects, alpha, notes, receipts],
        new Set(['Projects/Alpha']),
      ).map(({ path }) => path),
    ).toEqual(['Projects', 'Projects/Alpha', 'Receipts']);
  });
});

describe('chunkMessageUids', () => {
  it('keeps every UID in order while respecting the operation batch size', () => {
    expect(chunkMessageUids([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rejects invalid chunk sizes', () => {
    expect(() => chunkMessageUids([1], 0)).toThrow(RangeError);
  });
});
