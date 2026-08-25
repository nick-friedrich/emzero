import type { ImapFlow, ListResponse } from 'imapflow';

type SubscriptionClient = Pick<ImapFlow, 'mailboxSubscribe'>;

/**
 * Keep every real folder returned by LIST subscribed. Emzero intentionally shows
 * all listed folders and does not expose a separate subscription preference, so
 * leaving a folder unsubscribed makes it disappear in clients such as IONOS
 * webmail even though it still exists on the server.
 */
export async function subscribeListedFolders(
  imap: SubscriptionClient,
  folders: ListResponse[],
): Promise<void> {
  for (const folder of folders) {
    if (!folder.listed || folder.subscribed || folder.flags.has('\\NonExistent')) continue;
    await imap.mailboxSubscribe(folder.path);
  }
}
