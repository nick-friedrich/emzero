import { describe, expect, it } from 'vitest';
import type { MailFolderSummary } from '../shared/accounts.js';
import { serverSearchFolders, serverSearchTokens } from './server-search.js';

function folder(path: string, specialUse: string | null = null, selectable = true): MailFolderSummary {
  return {
    path,
    name: path,
    parentPath: '',
    delimiter: '/',
    specialUse,
    selectable,
    unreadCount: 0,
    totalCount: 0,
  };
}

describe('server search folders', () => {
  const imapFolders = [
    folder('INBOX', '\\Inbox'),
    folder('Trash', '\\Trash'),
    folder('Projects'),
    folder('Hidden', null, false),
  ];

  it('searches one folder or every folder with a special use', () => {
    expect(serverSearchFolders(imapFolders, { folderPath: 'Projects' }).map((f) => f.path))
      .toEqual(['Projects']);
    expect(serverSearchFolders(imapFolders, { specialUse: '\\Trash' }).map((f) => f.path))
      .toEqual(['Trash']);
  });

  it('searches every selectable folder when no scope is given', () => {
    expect(serverSearchFolders(imapFolders, {}).map((f) => f.path))
      .toEqual(['INBOX', 'Trash', 'Projects']);
  });

  it('uses All Mail, Trash and Spam instead of every Gmail label', () => {
    const gmail = [
      folder('INBOX', '\\Inbox'),
      folder('[Gmail]/All Mail', '\\All'),
      folder('[Gmail]/Trash', '\\Trash'),
      folder('[Gmail]/Spam', '\\Junk'),
      folder('Receipts'),
    ];
    expect(serverSearchFolders(gmail, {}).map((f) => f.path))
      .toEqual(['[Gmail]/All Mail', '[Gmail]/Trash', '[Gmail]/Spam']);
  });

  it('splits queries into a bounded list of words', () => {
    expect(serverSearchTokens('  invoice "ACME"  2026 ')).toEqual(['invoice', 'ACME', '2026']);
    expect(serverSearchTokens('a b c d e f g h')).toHaveLength(6);
  });
});
