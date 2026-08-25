import { afterEach, describe, expect, it } from 'vitest';
import type {
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSummary,
} from '../shared/accounts.js';
import { MailCache } from './mail-cache.js';

const inbox: MailFolderSummary = {
  path: 'INBOX',
  name: 'INBOX',
  parentPath: '',
  delimiter: '/',
  specialUse: '\\Inbox',
  selectable: true,
  unreadCount: 2,
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

const detail: MailMessageDetail = {
  uid: 2,
  messageId: '<2@example.com>',
  subject: 'Message 2',
  from: [{ name: 'Sender', address: 'sender@example.com' }],
  to: [{ name: null, address: 'me@example.com' }],
  cc: [],
  replyTo: [],
  sentAt: '2026-08-02T10:00:00.000Z',
  text: 'Cached body',
  html: '<p>Cached body</p>',
  htmlHasQuotedText: false,
  attachments: [{ filename: 'note.txt', contentType: 'text/plain', size: 12, related: false }],
};

describe('MailCache', () => {
  let cache: MailCache | undefined;

  afterEach(() => cache?.close());

  it('stores folder metadata and preserves server order', () => {
    cache = new MailCache(':memory:');
    const archive = { ...inbox, path: 'Archive', name: 'Archive', specialUse: '\\Archive' };

    cache.replaceFolders('account-1', [inbox, archive]);

    expect(cache.listFolders('account-1')).toEqual([inbox, archive]);
  });

  it('persists custom sibling order across server folder refreshes', () => {
    cache = new MailCache(':memory:');
    const alpha = { ...inbox, path: 'Alpha', name: 'Alpha', specialUse: null };
    const beta = { ...inbox, path: 'Beta', name: 'Beta', specialUse: null };
    cache.replaceFolders('account-1', [inbox, alpha, beta]);

    cache.reorderFolderSiblings('account-1', '', ['Beta', 'INBOX', 'Alpha']);
    expect(cache.listFolders('account-1').map(({ path }) => path)).toEqual([
      'Beta',
      'INBOX',
      'Alpha',
    ]);

    cache.replaceFolders('account-1', [inbox, alpha, beta]);
    expect(cache.listFolders('account-1').map(({ path }) => path)).toEqual([
      'Beta',
      'INBOX',
      'Alpha',
    ]);
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

  it('suggests cached senders and sent-mail recipients by name or address', () => {
    cache = new MailCache(':memory:');
    const sent = { ...inbox, path: 'Sent', name: 'Sent', specialUse: '\\Sent', unreadCount: 0 };
    cache.replaceFolders('account-1', [inbox, sent]);
    cache.replaceRecentMessages(
      'account-1',
      'INBOX',
      [
        {
          ...message(1),
          from: [{ name: 'Alice Example', address: 'alice@example.com' }],
        },
      ],
      1,
    );
    cache.replaceRecentMessages(
      'account-1',
      'Sent',
      [
        {
          ...message(2),
          folderPath: 'Sent',
          from: [{ name: 'Me', address: 'me@example.com' }],
          to: [{ name: 'Bob Example', address: 'bob@example.com' }],
        },
      ],
      1,
    );

    expect(cache.searchRecipients('account-1', 'ali')).toEqual([
      { name: 'Alice Example', address: 'alice@example.com' },
    ]);
    expect(cache.searchRecipients('account-1', 'bob')).toEqual([
      { name: 'Bob Example', address: 'bob@example.com' },
    ]);
    expect(cache.searchRecipients('account-1', 'bob', ['BOB@example.com'])).toEqual([]);
  });

  it('searches cached headers and ranks subject matches', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages(
      'account-1',
      'INBOX',
      [
        message(1, 'Quarterly planning'),
        {
          ...message(2, 'Project update'),
          from: [{ name: 'Quarterly Team', address: 'team@example.com' }],
        },
      ],
      2,
    );

    const results = cache.searchMessages('quarter');

    expect(results.map(({ message: result }) => result.uid)).toEqual([1, 2]);
    expect(results[0]).toMatchObject({
      accountId: 'account-1',
      folder: { path: 'INBOX', specialUse: '\\Inbox' },
      message: { subject: 'Quarterly planning' },
    });
  });

  it('adds cached bodies to search and removes deleted messages from results', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(2)], 1);

    expect(cache.searchMessages('cached')).toEqual([]);
    cache.putMessageBody('account-1', 'INBOX', detail);
    expect(cache.searchMessages('cached')[0]).toMatchObject({
      message: { uid: 2 },
      snippet: 'Cached body',
    });

    cache.deleteMessages('account-1', 'INBOX', [2]);
    expect(cache.searchMessages('cached')).toEqual([]);
    expect(cache.searchMessages('message')).toEqual([]);
  });

  it('filters search results by account and folder', () => {
    cache = new MailCache(':memory:');
    const archive = { ...inbox, path: 'Archive', name: 'Archive', specialUse: '\\Archive' };
    cache.replaceFolders('account-1', [inbox, archive]);
    cache.replaceFolders('account-2', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1, 'Shared term')], 1);
    cache.replaceRecentMessages(
      'account-1',
      'Archive',
      [{ ...message(2, 'Shared term'), folderPath: 'Archive' }],
      1,
    );
    cache.replaceRecentMessages('account-2', 'INBOX', [message(3, 'Shared term')], 1);

    expect(cache.searchMessages('shared', { accountId: 'account-2' })).toHaveLength(1);
    expect(cache.searchMessages('shared', { accountId: 'account-1', folderPath: 'Archive' }))
      .toMatchObject([{ accountId: 'account-1', folder: { path: 'Archive' } }]);
  });

  it('sorts search results by relevance or date', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages(
      'account-1',
      'INBOX',
      [
        message(1, 'Quarterly planning'),
        {
          ...message(2, 'Project update'),
          from: [{ name: 'Quarterly Team', address: 'team@example.com' }],
        },
      ],
      2,
    );

    expect(cache.searchMessages('quarter', { sort: 'relevance' }).map(({ message }) => message.uid))
      .toEqual([1, 2]);
    expect(cache.searchMessages('quarter', { sort: 'newest' }).map(({ message }) => message.uid))
      .toEqual([2, 1]);
    expect(cache.searchMessages('quarter', { sort: 'oldest' }).map(({ message }) => message.uid))
      .toEqual([1, 2]);
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

  it('reconciles deleted UIDs and records incremental sync state', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1), message(2)], 2);

    cache.applyIncrementalSync('account-1', 'INBOX', [message(2, 'Updated'), message(3)], [2, 3], {
      uidValidity: '99',
      uidNext: 4,
      highestModseq: '120',
      syncedAt: 'later',
    });

    expect(cache.getFolderSyncState('account-1', 'INBOX')).toEqual({
      messages: [message(3), message(2, 'Updated')],
      total: 2,
      syncedAt: 'later',
      uidValidity: '99',
      uidNext: 4,
      highestModseq: '120',
    });
  });

  it('invalidates messages and bodies when UIDVALIDITY changes', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.applyIncrementalSync('account-1', 'INBOX', [message(2)], [2], {
      uidValidity: '1',
      uidNext: 3,
      highestModseq: null,
    });
    cache.putMessageBody('account-1', 'INBOX', detail);

    cache.applyIncrementalSync('account-1', 'INBOX', [message(1)], [1], {
      uidValidity: '2',
      uidNext: 2,
      highestModseq: null,
    });

    expect(cache.listMessageUids('account-1', 'INBOX')).toEqual([1]);
    expect(cache.getMessageBody('account-1', 'INBOX', 2)).toBeNull();
  });

  it('stores parsed message bodies for offline reading', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(2)], 1);

    cache.putMessageBody('account-1', 'INBOX', detail);

    expect(cache.getMessageBody('account-1', 'INBOX', 2)).toEqual(detail);
  });

  it('updates unread state and removes messages from the cache', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1), message(2)], 2);

    cache.setMessagesUnread('account-1', 'INBOX', [1], true);
    expect(cache.listMessages('account-1', 'INBOX').messages.map(({ uid, unread }) => ({ uid, unread }))).toEqual([
      { uid: 2, unread: true },
      { uid: 1, unread: true },
    ]);

    cache.deleteMessages('account-1', 'INBOX', [2]);
    expect(cache.listMessages('account-1', 'INBOX')).toMatchObject({
      messages: [{ uid: 1, unread: true }],
      total: 1,
    });
    expect(cache.listFolders('account-1')[0].unreadCount).toBe(1);
  });

  it('updates flagged state in the cache', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1), message(2)], 2);

    cache.setMessagesFlagged('account-1', 'INBOX', [1], true);
    expect(
      cache.listMessages('account-1', 'INBOX').messages
        .map(({ uid, flagged }) => ({ uid, flagged })),
    ).toEqual([
      { uid: 2, flagged: true },
      { uid: 1, flagged: true },
    ]);

    cache.setMessagesFlagged('account-1', 'INBOX', [2], false);
    expect(
      cache.listMessages('account-1', 'INBOX').messages
        .map(({ uid, flagged }) => ({ uid, flagged })),
    ).toEqual([
      { uid: 2, flagged: false },
      { uid: 1, flagged: true },
    ]);
  });

  it('invalidates folder sync metadata after an external change', () => {
    cache = new MailCache(':memory:');
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1)], 1, 'now');
    expect(cache.getFolderSyncState('account-1', 'INBOX').syncedAt).toBe('now');

    cache.invalidateFolder('account-1', 'INBOX');
    expect(cache.getFolderSyncState('account-1', 'INBOX')).toMatchObject({
      syncedAt: null,
      uidValidity: null,
      uidNext: null,
      highestModseq: null,
    });
  });

  it('removes moved messages and invalidates the destination cache', () => {
    cache = new MailCache(':memory:');
    const archive = { ...inbox, path: 'Archive', name: 'Archive', specialUse: '\\Archive', unreadCount: 0 };
    cache.replaceFolders('account-1', [inbox, archive]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1), message(2)], 2, 'inbox-sync');
    cache.replaceRecentMessages(
      'account-1',
      'Archive',
      [{ ...message(3), folderPath: 'Archive' }],
      1,
      'archive-sync',
    );

    cache.moveMessages('account-1', 'INBOX', 'Archive', [2]);

    expect(cache.listMessages('account-1', 'INBOX')).toMatchObject({
      messages: [{ uid: 1 }],
      total: 1,
    });
    expect(cache.getFolderSyncState('account-1', 'Archive')).toMatchObject({
      messages: [{ uid: 3 }],
      total: 2,
      syncedAt: null,
      uidValidity: null,
      uidNext: null,
      highestModseq: null,
    });
    expect(cache.listFolders('account-1')).toMatchObject([
      { path: 'INBOX', unreadCount: 1 },
      { path: 'Archive', unreadCount: 1 },
    ]);
  });

  it('moves cached message state between accounts and invalidates the destination', () => {
    cache = new MailCache(':memory:');
    const destinationInbox = { ...inbox, unreadCount: 0 };
    cache.replaceFolders('account-1', [inbox]);
    cache.replaceFolders('account-2', [destinationInbox]);
    cache.replaceRecentMessages('account-1', 'INBOX', [message(1), message(2)], 2, 'source-sync');
    cache.replaceRecentMessages('account-2', 'INBOX', [], 0, 'destination-sync');

    cache.transferMessages('account-1', 'INBOX', 'account-2', 'INBOX', [2]);

    expect(cache.listMessages('account-1', 'INBOX')).toMatchObject({
      messages: [{ uid: 1 }],
      total: 1,
    });
    expect(cache.getFolderSyncState('account-2', 'INBOX')).toMatchObject({
      messages: [],
      total: 1,
      syncedAt: null,
      uidValidity: null,
      uidNext: null,
      highestModseq: null,
    });
    expect(cache.listFolders('account-2')[0]).toMatchObject({ unreadCount: 1 });
  });
});
