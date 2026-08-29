import type {
  AccountSummary,
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSummary,
} from '../../shared/accounts';
import { groupMessagesIntoConversations } from '../../shared/conversations';
import type { MailboxSelection, UnifiedConversationItem } from './mail-common';

export const demoModeStorageKey = 'emzero.demo-mode';

export const demoAccounts: AccountSummary[] = [
  {
    id: 'demo-work', name: 'Studio', email: 'hello@northstar.studio',
    username: 'hello@northstar.studio', authentication: 'password',
    imap: { host: 'mail.example.com', port: 993, secure: true },
    smtp: { host: 'mail.example.com', port: 465, secure: true },
    createdAt: '2026-01-10T09:00:00.000Z',
  },
  {
    id: 'demo-personal', name: 'Personal', email: 'alex@example.com',
    username: 'alex@example.com', authentication: 'password',
    imap: { host: 'mail.example.com', port: 993, secure: true },
    smtp: { host: 'mail.example.com', port: 465, secure: true },
    createdAt: '2026-01-11T09:00:00.000Z',
  },
];

function folder(path: string, specialUse: string | null, unreadCount = 0): MailFolderSummary {
  return { path, name: path, parentPath: '', delimiter: '/', specialUse, selectable: true, unreadCount };
}

export const demoFolders: Record<string, MailFolderSummary[]> = {
  'demo-work': [
    folder('Inbox', '\\Inbox', 5), folder('Sent', '\\Sent'), folder('Drafts', '\\Drafts'),
    folder('Archive', '\\Archive'), folder('Launch', null, 2), folder('Trash', '\\Trash'),
  ],
  'demo-personal': [
    folder('Inbox', '\\Inbox', 3), folder('Sent', '\\Sent'), folder('Drafts', '\\Drafts'),
    folder('Archive', '\\Archive'), folder('Receipts', null), folder('Trash', '\\Trash'),
  ],
};

type DemoSeed = {
  id: string;
  accountId: string;
  folderPath: string;
  sender: string;
  address: string;
  subject: string;
  body: string;
  sentAt: string;
  unread?: boolean;
  flagged?: boolean;
  attachment?: string;
};

const seeds: DemoSeed[] = [
  {
    id: 'launch-review', accountId: 'demo-work', folderPath: 'Inbox', sender: 'Maya Chen',
    address: 'maya@northstar.studio', subject: 'The launch page is ready for review',
    body: 'Hey Alex,\n\nI wrapped up the final responsive pass and added the new product shots. Everything is staged and ready for your review. The mobile layout feels especially crisp now.\n\nI attached the final launch checklist so we can close out the last few details tomorrow.\n\nMaya',
    sentAt: '2026-08-27T10:42:00.000Z', unread: true, flagged: true,
    attachment: 'launch-checklist.pdf',
  },
  {
    id: 'early-access', accountId: 'demo-work', folderPath: 'Inbox', sender: 'Jon Bell',
    address: 'jon@fieldnotes.co', subject: 'Re: Early access invite',
    body: 'Count me in — the unified inbox is exactly what I have been looking for. The keyboard navigation looks fantastic too. Happy to share feedback after I have used it for a week.',
    sentAt: '2026-08-27T09:18:00.000Z', unread: true,
  },
  {
    id: 'weekly-digest', accountId: 'demo-personal', folderPath: 'Inbox', sender: 'Linear',
    address: 'updates@linear.app', subject: 'Your week in review',
    body: 'Your workspace had a productive week. Twelve issues were completed across three active projects, with an average cycle time of 1.8 days.',
    sentAt: '2026-08-26T16:05:00.000Z', flagged: true,
  },
  {
    id: 'coffee', accountId: 'demo-personal', folderPath: 'Inbox', sender: 'Sam Rivera',
    address: 'sam@example.com', subject: 'Coffee next week?',
    body: 'I will be nearby on Thursday. Want to try that new place on Oak Street? I hear their cardamom buns are worth the trip.',
    sentAt: '2026-08-26T11:34:00.000Z', unread: true,
  },
  {
    id: 'receipt', accountId: 'demo-personal', folderPath: 'Inbox', sender: 'Acme Hosting',
    address: 'billing@acme.test', subject: 'Receipt for August 2026',
    body: 'Thanks for your payment. Your August hosting receipt is attached for your records.',
    sentAt: '2026-08-25T13:20:00.000Z', attachment: 'receipt-august.pdf',
  },
  {
    id: 'roadmap', accountId: 'demo-work', folderPath: 'Launch', sender: 'Priya Shah',
    address: 'priya@northstar.studio', subject: 'Q4 roadmap notes',
    body: 'Here are the themes we agreed on after the planning session: focus, speed, and a calmer first-run experience.',
    sentAt: '2026-08-24T15:10:00.000Z', unread: true,
  },
  {
    id: 'partner-follow-up', accountId: 'demo-personal', folderPath: 'Drafts', sender: 'Alex Morgan',
    address: 'alex@example.com', subject: 'Re: Partnership details',
    body: 'Hi Jordan,\n\nThanks for sending the outline. I added a few notes below and will confirm the timeline tomorrow.\n\nAlex',
    sentAt: '2026-08-24T12:30:00.000Z',
  },
  {
    id: 'intro', accountId: 'demo-work', folderPath: 'Sent', sender: 'Alex Morgan',
    address: 'hello@northstar.studio', subject: 'A calmer way to manage email',
    body: 'Thanks for taking a look at Emzero. Here is a quick overview of what we are building and why we think email can feel calmer.',
    sentAt: '2026-08-24T09:00:00.000Z',
  },
];

const summaries = seeds.map((seed, index): MailMessageSummary => {
  const account = demoAccounts.find((candidate) => candidate.id === seed.accountId)!;
  const fromSelf = seed.folderPath === 'Sent' || seed.folderPath === 'Drafts';
  return {
    folderPath: seed.folderPath,
    uid: 10_000 + index,
    messageId: `<demo-${seed.id}@emzero.test>`,
    inReplyTo: null,
    references: [],
    subject: seed.subject,
    from: [{ name: seed.sender, address: seed.address }],
    to: [{ name: fromSelf ? 'Maya Chen' : account.name, address: fromSelf ? 'maya@example.com' : account.email }],
    sentAt: seed.sentAt,
    receivedAt: seed.sentAt,
    unread: Boolean(seed.unread),
    flagged: Boolean(seed.flagged),
    size: seed.body.length * 4,
  };
});

export type DemoMailboxSnapshot = {
  title: string;
  items: UnifiedConversationItem[];
  details: ReadonlyMap<string, MailMessageDetail>;
};

export function demoDetailKey(accountId: string, folderPath: string, uid: number): string {
  return `${accountId}:${folderPath}:${uid}`;
}

export function demoMailboxSnapshot(selection: MailboxSelection): DemoMailboxSnapshot {
  let selected = summaries;
  let title = 'Inbox';
  if (selection.kind === 'folder') {
    selected = summaries.filter((message, index) =>
      seeds[index].accountId === selection.account.id && message.folderPath === selection.folder.path,
    );
    title = selection.folder.name;
  } else if (selection.kind === 'search') {
    const query = selection.query.trim().toLowerCase();
    selected = query
      ? summaries.filter((message) =>
          [message.subject, ...message.from.map(({ name, address }) => `${name} ${address}`)]
            .some((value) => value.toLowerCase().includes(query)),
        )
      : summaries;
    title = selection.query ? `Search: ${selection.query}` : 'Search mail';
  } else if (selection.mailbox === 'starred') {
    selected = summaries.filter((message) => message.flagged);
    title = 'Starred';
  } else if (selection.mailbox === 'trash') {
    selected = [];
    title = 'Trash';
  } else if (selection.mailbox === 'drafts') {
    selected = summaries.filter((message) => message.folderPath === 'Drafts');
    title = 'Drafts';
  } else {
    selected = summaries.filter((message) => message.folderPath === 'Inbox');
  }

  const items = demoAccounts.flatMap((account): UnifiedConversationItem[] => {
    const folders = demoFolders[account.id];
    const accountMessages = selected.filter((message) => {
      const seed = seeds[summaries.indexOf(message)];
      return seed.accountId === account.id;
    });
    return groupMessagesIntoConversations(accountMessages).map((conversation) => ({
      selection: {
        kind: 'folder',
        account,
        folder: folders.find((candidate) => candidate.path === conversation.messages[0].folderPath) ?? folders[0],
      },
      folders,
      conversation,
    }));
  });
  items.sort((left, right) =>
    new Date(right.conversation.messages[0].sentAt ?? 0).getTime() -
    new Date(left.conversation.messages[0].sentAt ?? 0).getTime(),
  );

  const details = new Map<string, MailMessageDetail>();
  summaries.forEach((message, index) => {
    const seed = seeds[index];
    details.set(demoDetailKey(seed.accountId, message.folderPath, message.uid), {
      uid: message.uid,
      messageId: message.messageId,
      subject: message.subject,
      from: message.from,
      to: message.to,
      cc: [],
      replyTo: message.from,
      sentAt: message.sentAt,
      text: seed.body,
      html: null,
      htmlHasQuotedText: false,
      attachments: seed.attachment
        ? [{ filename: seed.attachment, contentType: 'application/pdf', size: 248_000, related: false }]
        : [],
    });
  });
  return { title, items, details };
}
