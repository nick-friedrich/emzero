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
  message?: string;
}

export interface AccountOperationResult {
  ok: boolean;
  message: string;
  account?: AccountSummary;
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
  providers: 'providers:list',
  discoverProvider: 'providers:discover',
  listFolders: 'folders:list',
  listMessages: 'messages:list',
  getMessage: 'messages:get',
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
