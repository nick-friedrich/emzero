import {
  findInboxFolder,
  type AccountSummary,
  type MailFolderSummary,
  type MailMessageSummary,
} from '../../shared/accounts';
import { groupMessagesWithRelated, type MailConversation } from '../../shared/conversations';
import type { DraftDeletedEvent } from './compose-dialog';
import type {
  FolderSelection,
  UnifiedAccountFailure,
  UnifiedConversationItem,
  UnifiedInboxLoadState,
} from './mail-common';

export type UnifiedMailbox = 'inbox' | 'starred' | 'drafts' | 'trash';

export interface UnifiedLoadOptions {
  mailbox: UnifiedMailbox;
  /** Mailbox name used in failure messages. */
  title: string;
  /** Keeps only matching messages (smart inboxes, skip-Inbox rules). */
  messageFilter: ((message: MailMessageSummary) => boolean) | null;
  /** Bypass caches and ask the server. */
  force: boolean;
}

export type UnifiedAccountLoad =
  | { account: AccountSummary; failure: UnifiedAccountFailure }
  | {
      account: AccountSummary;
      items: UnifiedConversationItem[];
      loadedMessages: number;
      totalMessages: number;
      notices: string[];
    };

export function unifiedItemKey(item: UnifiedConversationItem): string {
  return `${item.selection.account.id}:${item.conversation.id}`;
}

export function conversationTime(conversation: MailConversation): number {
  const latest = conversation.messages[0];
  const value = latest?.sentAt ?? latest?.receivedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

const specialUseByMailbox = { starred: '\\Flagged', drafts: '\\Drafts', trash: '\\Trash' } as const;

/**
 * Loads one account's share of a unified mailbox: its source folder(s) plus the
 * Sent/Drafts (or Inbox) messages that complete conversations.
 */
export async function loadUnifiedAccount(
  account: AccountSummary,
  { mailbox, title, messageFilter, force }: UnifiedLoadOptions,
): Promise<UnifiedAccountLoad> {
  const failure = (message: string): UnifiedAccountLoad => ({ account, failure: { account, message } });
  try {
    const folderResult = await window.emzero.folders.list(account.id, force);
    if (!folderResult.ok) return failure(folderResult.message ?? 'Could not load folders.');

    const folders = folderResult.folders;
    const designatedFolder = mailbox === 'inbox'
      ? findInboxFolder(folders)
      : folders.find((candidate) => candidate.selectable && candidate.specialUse === specialUseByMailbox[mailbox]);
    const sourceFolders = designatedFolder
      ? [designatedFolder]
      : mailbox === 'starred'
        ? folders.filter((candidate) => candidate.selectable && candidate.specialUse !== '\\Trash')
        : [];
    if (sourceFolders.length === 0) return failure(`No selectable ${title.toLowerCase()} folder was found.`);

    const sentFolder = folders.find((candidate) => candidate.selectable && candidate.specialUse === '\\Sent');
    const inboxFolder = findInboxFolder(folders);
    const draftsFolder = folders.find((candidate) => candidate.selectable && candidate.specialUse === '\\Drafts');
    const relatedFolders = mailbox === 'inbox'
      ? [sentFolder, draftsFolder]
      : mailbox === 'drafts'
        ? [sentFolder, inboxFolder]
        : [];
    const [sourceResults, relatedResults] = await Promise.all([
      Promise.all(sourceFolders.map((folder) =>
        window.emzero.messages.list(account.id, folder.path, force).then((result) => ({ folder, result })),
      )),
      Promise.all(relatedFolders.flatMap((folder) =>
        folder && folder.path !== designatedFolder?.path
          ? [window.emzero.messages.list(account.id, folder.path, force).then((result) => ({ folder, result }))]
          : [],
      )),
    ]);
    const failedResult = sourceResults.find(({ result }) => !result.ok);
    if (failedResult) {
      return failure(failedResult.result.message ?? `Could not load ${title.toLowerCase()} messages.`);
    }

    const loadedSources = sourceResults.map(({ folder, result }) => {
      const messages = result.messages
        .filter((message) => mailbox !== 'starred' || message.flagged)
        .filter((message) => !messageFilter || messageFilter(message))
        .map((message) => ({ ...message, folderPath: folder.path }));
      return {
        folder,
        supportsEmzeroKeywords: Boolean(result.supportsEmzeroKeywords),
        messages,
        total: mailbox === 'starred' || messageFilter ? messages.length : result.total,
        notice: result.message,
      };
    });
    const relatedMessages = mailbox === 'inbox' || mailbox === 'drafts'
      ? relatedResults.flatMap(({ folder, result }) =>
          result.ok ? result.messages.map((message) => ({ ...message, folderPath: folder.path })) : [],
        )
      : [];
    return {
      account,
      items: loadedSources.flatMap(({ folder, messages, supportsEmzeroKeywords }) => {
        const selection: FolderSelection = { kind: 'folder', account, folder };
        return groupMessagesWithRelated(messages, relatedMessages).map((conversation) => ({
          selection,
          folders,
          conversation,
          supportsEmzeroKeywords,
        }));
      }),
      loadedMessages: loadedSources.reduce((total, source) => total + source.messages.length, 0),
      totalMessages: loadedSources.reduce((total, source) => total + source.total, 0),
      notices: [
        folderResult.message,
        ...loadedSources.map(({ notice }) => notice),
        ...relatedResults.map(({ result }) => result.message),
      ].filter((message): message is string => Boolean(message)),
    };
  } catch {
    return failure('Could not connect to this account.');
  }
}

/** Combines per-account loads into list state, newest conversation first. */
export function unifiedInboxState(
  results: readonly UnifiedAccountLoad[],
  pendingAccounts: number,
  isHidden: (key: string) => boolean,
): UnifiedInboxLoadState {
  const loaded = results.flatMap((result) => ('items' in result ? [result] : []));
  return {
    status: 'loaded',
    items: loaded
      .flatMap((result) => result.items)
      .filter((item) => !isHidden(unifiedItemKey(item)))
      .sort((left, right) => conversationTime(right.conversation) - conversationTime(left.conversation)),
    failures: results.flatMap((result) => ('failure' in result ? [result.failure] : [])),
    notices: loaded.flatMap((result) => result.notices.map((message) => ({ account: result.account, message }))),
    loadedMessages: loaded.reduce((total, result) => total + result.loadedMessages, 0),
    totalMessages: loaded.reduce((total, result) => total + result.totalMessages, 0),
    pendingAccounts,
  };
}

type LoadedUnifiedState = Extract<UnifiedInboxLoadState, { status: 'loaded' }>;

/**
 * Rebuilds one account's conversations after a draft was saved, so the new draft
 * joins its conversation (Inbox) or replaces the account's drafts (Drafts).
 */
export function unifiedStateWithSavedDrafts(
  current: LoadedUnifiedState,
  {
    mailbox,
    account,
    folders,
    sourceFolder,
    draftFolderPath,
    draftMessages,
    draftTotal,
    draftsSupportEmzeroKeywords,
  }: {
    mailbox: UnifiedMailbox;
    account: AccountSummary;
    folders: MailFolderSummary[];
    sourceFolder: MailFolderSummary;
    draftFolderPath: string;
    draftMessages: MailMessageSummary[];
    draftTotal: number;
    draftsSupportEmzeroKeywords: boolean;
  },
): { state: LoadedUnifiedState; replacementItems: UnifiedConversationItem[] } {
  const accountItems = current.items.filter((item) => item.selection.account.id === account.id);
  const existingMessages = [
    ...new Map(
      accountItems.flatMap((item) => item.conversation.messages).map(
        (message) => [`${message.folderPath}:${message.uid}`, message] as const,
      ),
    ).values(),
  ];
  const primaryMessages = mailbox === 'drafts'
    ? draftMessages
    : existingMessages.filter((message) => message.folderPath === sourceFolder.path);
  const relatedMessages = [
    ...(mailbox === 'inbox' ? draftMessages : []),
    ...existingMessages.filter(
      (message) => message.folderPath !== sourceFolder.path && message.folderPath !== draftFolderPath,
    ),
  ];
  const selection: FolderSelection = { kind: 'folder', account, folder: sourceFolder };
  const replacementItems = groupMessagesWithRelated(primaryMessages, relatedMessages).map((conversation) => ({
    selection,
    folders,
    conversation,
    supportsEmzeroKeywords: mailbox === 'drafts'
      ? draftsSupportEmzeroKeywords
      : Boolean(sourceFolder.supportsEmzeroKeywords),
  }));
  const items = [
    ...current.items.filter((item) => item.selection.account.id !== account.id),
    ...replacementItems,
  ].sort((left, right) => conversationTime(right.conversation) - conversationTime(left.conversation));
  const previousPrimaryCount = existingMessages.filter(
    (message) => message.folderPath === sourceFolder.path,
  ).length;
  return {
    replacementItems,
    state: {
      ...current,
      items,
      loadedMessages: mailbox === 'drafts'
        ? current.loadedMessages - previousPrimaryCount + draftMessages.length
        : current.loadedMessages,
      totalMessages: mailbox === 'drafts'
        ? current.totalMessages - previousPrimaryCount + draftTotal
        : current.totalMessages,
    },
  };
}

/** Drops deleted draft messages, and in Drafts any conversation left without a draft. */
export function unifiedStateWithoutDrafts(
  current: LoadedUnifiedState,
  mailbox: UnifiedMailbox,
  event: DraftDeletedEvent,
): LoadedUnifiedState {
  const deleted = new Set(event.references.map((reference) => `${reference.folderPath}:${reference.uid}`));
  const draftFolderPaths = new Set(event.references.map((reference) => reference.folderPath));
  let removedMessages = 0;
  const items = current.items.flatMap((item) => {
    if (item.selection.account.id !== event.accountId) return [item];
    const messages = item.conversation.messages.filter((message) => {
      const remove = deleted.has(`${message.folderPath}:${message.uid}`);
      if (remove) removedMessages += 1;
      return !remove;
    });
    const remainsInDrafts = mailbox !== 'drafts' || messages.some(
      (message) => draftFolderPaths.has(message.folderPath),
    );
    return messages.length > 0 && remainsInDrafts
      ? [{ ...item, conversation: { ...item.conversation, messages } }]
      : [];
  });
  const removedPrimaryMessages = mailbox === 'drafts' ? removedMessages : 0;
  return {
    ...current,
    items,
    loadedMessages: Math.max(0, current.loadedMessages - removedPrimaryMessages),
    totalMessages: Math.max(0, current.totalMessages - removedPrimaryMessages),
  };
}
