import { afterEach, describe, expect, it } from 'vitest';
import type { MailFolderSummary, MailMessageSummary } from '../shared/accounts.js';
import { MailCache } from './mail-cache.js';

const inbox: MailFolderSummary = {
  path: 'INBOX',
  name: 'INBOX',
  parentPath: '',
  delimiter: '/',
  specialUse: '\\Inbox',
  selectable: true,
};

function message(uid: number, subject = `Message ${uid}`): MailMessageSummary {
  return {
    folderPath: 'INBOX',
    uid,
    messageId: `<${uid}@example.com>`,
    inReplyTo: null,
    references: [],
    subject,
    from: [{ name: 'Sender', address: 'sender@example.com' }],
    to: [{ name: null, address: 'me@example.com' }],
    sentAt: `2026-08-${String(uid).padStart(2, '0')}T10:00:00.000Z`,
    receivedAt: `2026-08-${String(uid).padStart(2, '0')}T10:00:01.000Z`,
    unread: uid % 2 === 0,
    flagged: uid === 2,
    size: 100 + uid,
  };
}

describe('MailCache', () => {
  let cache: MailCache | undefined;

  afterEach(() => cache?.close());

  it('stores folder metadata and preserves server order', () => {
    cache = new MailCache(':memory:');
    const archive = { ...inbox, path: 'Archive', name: 'Archive', specialUse: '\\Archive' };

    cache.replaceFolders('account-1', [inbox, archive]);

    expect(cache.listFolders('account-1')).toEqual([inbox, archive]);
  });

  it('stores message summaries and sync metadata newest first', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);

    cache.replaceRecentMessages('account-1', 'INBOX', [message(1), message(2)], 25, 'now');

    expect(cache.listMessages('account-1', 'INBOX')).toEqual({
      messages: [message(2), message(1)],
      total: 25,
      syncedAt: 'now',
    });
  });

  it('replaces the synced UID window while retaining older cached messages', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages(
      'account-1',
      'INBOX',
      [message(1), message(2), message(3)],
      3,
    );

    cache.replaceRecentMessages('account-1', 'INBOX', [message(2, 'Updated'), message(4)], 3);

    expect(cache.listMessages('account-1', 'INBOX').messages).toEqual([
      message(4),
      message(2, 'Updated'),
      message(1),
    ]);
  });

  it('removes cached messages when a synced folder becomes empty', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1)], 1);

    cache.replaceRecentMessages('account-1', 'INBOX', [], 0);

    expect(cache.listMessages('account-1', 'INBOX')).toMatchObject({ messages: [], total: 0 });
  });
});
