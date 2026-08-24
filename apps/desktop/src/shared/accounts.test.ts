import { describe, expect, it } from 'vitest';
import {
  accountUnreadCount,
  defaultAccountName,
  displayFolderName,
  findInboxFolder,
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
