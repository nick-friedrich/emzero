import type { ImapFlow, ListResponse } from 'imapflow';

type SubscriptionClient = Pick<ImapFlow, 'mailboxSubscribe'>;
type DeletionClient = Pick<ImapFlow, 'mailboxDelete' | 'mailboxUnsubscribe'>;

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

export async function deleteSubscribedFolder(
  imap: DeletionClient,
  path: string,
): Promise<void> {
  // IMAP DELETE does not remove an LSUB subscription. Unsubscribe first so
  // clients that render subscriptions do not retain a ghost folder afterward.
  // Some providers recreate the subscription while processing DELETE, so clear
  // it again after the mailbox itself is gone.
  await imap.mailboxUnsubscribe(path);
  await imap.mailboxDelete(path);
  await imap.mailboxUnsubscribe(path);
}
