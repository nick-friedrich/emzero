import { describe, expect, it, vi } from 'vitest';
import type { ListResponse } from 'imapflow';
import { deleteSubscribedFolder, subscribeListedFolders } from './folder-subscriptions.js';

function folder(
  path: string,
  { listed = true, subscribed = true, flags = [] as string[] } = {},
): ListResponse {
  return {
    path,
    pathAsListed: path,
    name: path.split('/').at(-1)!,
    delimiter: '/',
    parent: [],
    parentPath: '',
    flags: new Set(flags),
    listed,
    subscribed,
  };
}

describe('subscribeListedFolders', () => {
  it('subscribes folders that exist but are hidden from subscription-based clients', async () => {
    const mailboxSubscribe = vi.fn(async () => true);

    await subscribeListedFolders(
      { mailboxSubscribe },
      [folder('Archive'), folder('Archive/Rechnungen', { subscribed: false })],
    );

    expect(mailboxSubscribe).toHaveBeenCalledOnce();
    expect(mailboxSubscribe).toHaveBeenCalledWith('Archive/Rechnungen');
  });

  it('ignores phantom subscription entries that no longer exist', async () => {
    const mailboxSubscribe = vi.fn(async () => true);

    await subscribeListedFolders(
      { mailboxSubscribe },
      [folder('Deleted folder', { subscribed: false, flags: ['\\NonExistent'] })],
    );

    expect(mailboxSubscribe).not.toHaveBeenCalled();
  });
});

describe('deleteSubscribedFolder', () => {
  it('unsubscribes around deletion so other clients do not retain a ghost folder', async () => {
    const calls: string[] = [];
    const mailboxUnsubscribe = vi.fn(async () => {
      calls.push('unsubscribe');
      return true;
    });
    const mailboxDelete = vi.fn(async () => {
      calls.push('delete');
      return { path: 'Archive/Old' };
    });

    await deleteSubscribedFolder({ mailboxDelete, mailboxUnsubscribe }, 'Archive/Old');

    expect(calls).toEqual(['unsubscribe', 'delete', 'unsubscribe']);
    expect(mailboxUnsubscribe).toHaveBeenCalledTimes(2);
    expect(mailboxUnsubscribe).toHaveBeenNthCalledWith(1, 'Archive/Old');
    expect(mailboxUnsubscribe).toHaveBeenNthCalledWith(2, 'Archive/Old');
    expect(mailboxDelete).toHaveBeenCalledWith('Archive/Old');
  });
});
