export interface MailServerSettings {
  host: string;
  port: number;
  secure: boolean;
}

export interface AccountDraft {
  name: string;
  email: string;
  username: string;
  password: string;
  imap: MailServerSettings;
  smtp: MailServerSettings;
}

export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  username: string;
  imap: MailServerSettings;
  smtp: MailServerSettings;
  createdAt: string;
}

export interface MailFolderSummary {
  path: string;
  name: string;
  parentPath: string;
  delimiter: string;
  specialUse: string | null;
  selectable: boolean;
  unreadCount: number;
}

export function findInboxFolder(
  folders: MailFolderSummary[],
): MailFolderSummary | undefined {
  return (
    folders.find((folder) => folder.selectable && folder.specialUse === '\\Inbox') ??
    folders.find(
      (folder) =>
        folder.selectable &&
        (folder.path.toLowerCase() === 'inbox' || folder.name.toLowerCase() === 'inbox'),
    )
  );
}

export function displayFolderName(folder: MailFolderSummary): string {
  if (
    folder.specialUse === '\\Inbox' ||
    folder.name.toLowerCase() === 'inbox' ||
    folder.path.toLowerCase() === 'inbox'
  ) {
    return 'Inbox';
  }
  return folder.name;
}

export function accountUnreadCount(folders: MailFolderSummary[]): number {
  return folders.reduce(
    (total, folder) =>
      total +
      (folder.selectable && folder.specialUse !== '\\Trash' ? folder.unreadCount : 0),
    0,
  );
}

export interface FolderListResult {
  ok: boolean;
  folders: MailFolderSummary[];
  source?: 'server' | 'cache';
  message?: string;
}

export interface MailAddressSummary {
  name: string | null;
  address: string | null;
}

export interface MailMessageSummary {
  folderPath: string;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: MailAddressSummary[];
  to: MailAddressSummary[];
  sentAt: string | null;
  receivedAt: string | null;
  unread: boolean;
  flagged: boolean;
  size: number | null;
}

export interface MessageListResult {
  ok: boolean;
  messages: MailMessageSummary[];
  total: number;
  source?: 'server' | 'cache';
  syncedAt?: string | null;
  message?: string;
}

export interface MailSearchRequest {
  query: string;
  accountId?: string;
  folderPath?: string;
  limit?: number;
  sort?: 'relevance' | 'newest' | 'oldest';
}

export interface MailSearchItem {
  accountId: string;
  folder: MailFolderSummary;
  message: MailMessageSummary;
  snippet: string | null;
}

export interface MailSearchResult {
  ok: boolean;
  items: MailSearchItem[];
  message?: string;
}

export type BulkMessageAction = 'read' | 'unread' | 'delete';

export interface BulkMessageGroup {
  accountId: string;
  folderPath: string;
  uids: number[];
}

export interface BulkMessageJobRequest {
  action: BulkMessageAction;
  groups: BulkMessageGroup[];
}

export interface BulkMessageJobStartResult {
  ok: boolean;
  jobId?: string;
  message?: string;
}

export interface BulkMessageJobProgress {
  jobId: string;
  action: BulkMessageAction;
  state: 'running' | 'stopping' | 'completed' | 'stopped' | 'error';
  total: number;
  processed: number;
  accountId?: string;
  folderPath?: string;
  processedUids?: number[];
  folder?: MailFolderSummary;
  message?: string;
}

export function chunkMessageUids(uids: number[], chunkSize: number): number[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('Chunk size must be a positive integer.');
  }
  const chunks: number[][] = [];
  for (let offset = 0; offset < uids.length; offset += chunkSize) {
    chunks.push(uids.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export interface MailAttachmentSummary {
  filename: string;
  contentType: string;
  size: number;
  related: boolean;
}

export interface MailMessageDetail {
  uid: number;
  messageId: string | null;
  subject: string;
  from: MailAddressSummary[];
  to: MailAddressSummary[];
  cc: MailAddressSummary[];
  replyTo: MailAddressSummary[];
  sentAt: string | null;
  text: string;
  html: string | null;
  htmlHasQuotedText: boolean;
  attachments: MailAttachmentSummary[];
}

export interface MessageDetailResult {
  ok: boolean;
  messageDetail?: MailMessageDetail;
  source?: 'server' | 'cache';
  message?: string;
}

export interface MessageOperationResult {
  ok: boolean;
  message?: string;
}

export interface MailSendDraft {
  to: MailAddressSummary[];
  cc: MailAddressSummary[];
  bcc: MailAddressSummary[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
}

export type MailReplyDraft = MailSendDraft;

export interface MailSendResult extends MessageOperationResult {
  messageId?: string;
  savedToSent?: boolean;
  sentMessage?: MailMessageSummary;
}

export interface RecipientSuggestion extends MailAddressSummary {
  address: string;
}

export interface AccountOperationResult {
  ok: boolean;
  message: string;
  account?: AccountSummary;
}

export interface AccountNameUpdate {
  name: string;
}

export interface MailSyncStatus {
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt: string | null;
  message?: string;
}

export interface MailProvider {
  id: string;
  name: string;
  domains: string[];
  mxPatterns: string[];
  imap: MailServerSettings;
  smtp: MailServerSettings;
  documentationUrl: string;
}

export interface ProviderDiscoveryResult {
  provider: MailProvider | null;
  detectedBy: 'domain' | 'mx' | null;
}

export const ACCOUNT_CHANNELS = {
  list: 'accounts:list',
  test: 'accounts:test',
  save: 'accounts:save',
  update: 'accounts:update',
  remove: 'accounts:remove',
  providers: 'providers:list',
  discoverProvider: 'providers:discover',
  listFolders: 'folders:list',
  listMessages: 'messages:list',
  searchMessages: 'messages:search',
  getMessage: 'messages:get',
  setMessageUnread: 'messages:set-unread',
  deleteMessages: 'messages:delete',
  startBulkMessageJob: 'messages:bulk-start',
  cancelBulkMessageJob: 'messages:bulk-cancel',
  bulkMessageJobChanged: 'messages:bulk-changed',
  sendReply: 'messages:send-reply',
  sendMessage: 'messages:send',
  suggestRecipients: 'messages:suggest-recipients',
  syncStatus: 'sync:status',
  syncNow: 'sync:now',
  syncChanged: 'sync:changed',
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function defaultAccountName(email: string): string {
  return email.trim();
}

export function validateAccountDraft(value: AccountDraft): string | null {
  if (!value.name.trim()) return 'Enter a name for this account.';
  if (!emailPattern.test(value.email.trim())) return 'Enter a valid email address.';
  if (!value.username.trim()) return 'Enter the username used by your mail provider.';
  if (!value.password) return 'Enter your password or app password.';

  for (const [label, server] of [
    ['IMAP', value.imap],
    ['SMTP', value.smtp],
  ] as const) {
    if (!server.host.trim()) return `Enter the ${label} server hostname.`;
    if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65_535) {
      return `Enter a valid ${label} port.`;
    }
  }

  return null;
}
