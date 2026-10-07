import type {
  MailFolderSummary,
  MailSearchItem,
  MailSearchRequest,
  MailSearchResult,
} from '../shared/accounts.js';
import { listAccountFolders } from './account-folders.js';
import type { StoredAccount } from './account-storage.js';
import { errorMessage, mailCache, withAccountImap } from './mail-runtime.js';
import { fetchSummaries } from './message-reader.js';

const maxTokens = 6;
const maxFolders = 40;
const maxMatchesPerFolder = 50;

/**
 * Picks the folders a server search visits. Gmail-style servers expose every
 * message in an All Mail folder, so searching it plus Trash and Spam avoids
 * scanning (and duplicating) every label.
 */
export function serverSearchFolders(
  folders: MailFolderSummary[],
  scope: Pick<MailSearchRequest, 'folderPath' | 'specialUse'>,
): MailFolderSummary[] {
  const selectable = folders.filter((folder) => folder.selectable);
  if (scope.folderPath) return selectable.filter((folder) => folder.path === scope.folderPath);
  if (scope.specialUse) return selectable.filter((folder) => folder.specialUse === scope.specialUse);
  if (selectable.some((folder) => folder.specialUse === '\\All')) {
    return selectable.filter((folder) =>
      ['\\All', '\\Trash', '\\Junk'].includes(folder.specialUse ?? ''),
    );
  }
  return selectable.slice(0, maxFolders);
}

export function serverSearchTokens(query: string): string[] {
  return (query.trim().match(/[\p{L}\p{N}@._+-]+/gu) ?? []).slice(0, maxTokens);
}

async function searchAccount(
  account: StoredAccount,
  tokens: string[],
  scope: Pick<MailSearchRequest, 'folderPath' | 'specialUse'>,
): Promise<MailSearchItem[]> {
  const folderResult = await listAccountFolders(account);
  if (!folderResult.ok) throw new Error(folderResult.message ?? 'Could not load folders.');
  const folders = serverSearchFolders(folderResult.folders, scope);
  if (folders.length === 0) return [];

  // The prefetch lane only carries bounded speculative reads, so a slow
  // search neither blocks opening messages nor waits behind background sync.
  let password = '';
  try {
    return await withAccountImap(
      account,
      async (imap, secret) => {
        password = secret;
        const items: MailSearchItem[] = [];
        for (const folder of folders) {
          const lock = await imap.getMailboxLock(folder.path, { readOnly: true });
          try {
            // IMAP TEXT matches one substring, so intersect one search per word.
            let matches = new Set<number>();
            for (const [index, token] of tokens.entries()) {
              const uids: number[] = (await imap.search({ text: token }, { uid: true })) || [];
              const previous = matches;
              matches = new Set(index === 0 ? uids : uids.filter((uid) => previous.has(uid)));
              if (matches.size === 0) break;
            }
            const newest = [...matches]
              .sort((left, right) => right - left)
              .slice(0, maxMatchesPerFolder);
            const summaries = await fetchSummaries(imap, folder.path, newest);
            mailCache().putSearchResults(account.id, folder.path, summaries);
            for (const message of summaries) {
              items.push({ accountId: account.id, folder, message, snippet: null });
            }
          } finally {
            lock.release();
          }
        }
        return items;
      },
      60_000,
      'prefetch',
    );
  } catch (error) {
    throw new Error(errorMessage(error, password), { cause: error });
  }
}

function messageTime(item: MailSearchItem): number {
  const value = Date.parse(item.message.receivedAt ?? item.message.sentAt ?? '');
  return Number.isFinite(value) ? value : 0;
}

export async function searchServerMessages(
  accounts: StoredAccount[],
  request: MailSearchRequest,
): Promise<MailSearchResult> {
  const tokens = serverSearchTokens(request.query);
  if (tokens.length === 0) return { ok: true, items: [] };
  const targets = request.accountId
    ? accounts.filter((account) => account.id === request.accountId)
    : accounts;
  if (targets.length === 0) return { ok: false, items: [], message: 'Account not found.' };

  const results = await Promise.allSettled(
    targets.map((account) => searchAccount(account, tokens, request)),
  );
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${targets[index].name}: ${errorMessage(result.reason, '')}`]
      : [],
  );
  if (failures.length === targets.length) {
    return { ok: false, items: [], message: `Server search failed. ${failures.join(' ')}` };
  }

  const direction = request.sort === 'oldest' ? 1 : -1;
  items.sort((left, right) => direction * (messageTime(left) - messageTime(right)));
  return {
    ok: true,
    items: items.slice(0, Math.max(1, Math.min(request.limit ?? 100, 200))),
    ...(failures.length > 0
      ? { message: `Some accounts could not be searched. ${failures.join(' ')}` }
      : {}),
  };
}
