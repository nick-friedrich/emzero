import { rm } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type {
  MailAddressSummary,
  MailAttachmentSummary,
  MailFolderSummary,
} from '../shared/accounts.js';
import type { MailCategory } from '../shared/mail-insights.js';
import { SMART_INBOX_TEMPLATES, type SmartInbox } from '../shared/mail-insights.js';
import { localDateKeyAfter, type EmzeroMessageColor } from '../shared/message-keywords.js';
import { writeAccounts, type StoredAccount } from './account-storage.js';
import { storeDemoMessages } from './demo-mail.js';
import { writeSmartInboxSettings } from './mail-insights.js';
import { closeMailCache, mailCache } from './mail-runtime.js';
import { writeSignatures } from './signature-storage.js';

// A privacy-safe sample mailbox for presentations. Every address uses a reserved
// `.example` or `.invalid` domain, and timestamps are relative to launch so the
// mail always looks fresh.

type DemoAccountKey = 'studio' | 'personal';

const unreachableServer = (host: string) => ({ host, port: 993, secure: true });

const demoAccounts: Record<DemoAccountKey, StoredAccount> = {
  studio: {
    id: 'demo-studio',
    name: 'Northstar Studio',
    email: 'alex@northstar.example',
    username: 'alex@northstar.example',
    authentication: 'password',
    imap: unreachableServer('imap.northstar.invalid'),
    smtp: { ...unreachableServer('smtp.northstar.invalid'), port: 465 },
    createdAt: '2026-01-10T09:00:00.000Z',
    color: 'blue',
    aliases: [{ address: 'hello@northstar.example', name: 'Northstar Studio' }],
    encryptedSecret: '',
  },
  personal: {
    id: 'demo-personal',
    // The account name doubles as the From name on sent mail.
    name: 'Alex Morgan',
    email: 'alex.morgan@mail.example',
    username: 'alex.morgan@mail.example',
    authentication: 'password',
    imap: unreachableServer('imap.mail.invalid'),
    smtp: { ...unreachableServer('smtp.mail.invalid'), port: 465 },
    createdAt: '2026-01-11T09:00:00.000Z',
    color: 'orange',
    aliases: [],
    encryptedSecret: '',
  },
};

function folder(path: string, specialUse: string | null = null): MailFolderSummary {
  const separator = path.lastIndexOf('/');
  return {
    path,
    name: path.slice(separator + 1),
    parentPath: separator < 0 ? '' : path.slice(0, separator),
    delimiter: '/',
    specialUse,
    selectable: true,
    unreadCount: 0,
    totalCount: 0,
  };
}

const demoFolders: Record<DemoAccountKey, MailFolderSummary[]> = {
  studio: [
    folder('Inbox', '\\Inbox'),
    folder('Drafts', '\\Drafts'),
    folder('Sent', '\\Sent'),
    folder('Archive', '\\Archive'),
    folder('Clients'),
    folder('Clients/Halcyon Coffee'),
    folder('Clients/Fieldnotes'),
    folder('Launch'),
    folder('Spam', '\\Junk'),
    folder('Trash', '\\Trash'),
  ],
  personal: [
    folder('Inbox', '\\Inbox'),
    folder('Drafts', '\\Drafts'),
    folder('Sent', '\\Sent'),
    folder('Archive', '\\Archive'),
    folder('Receipts'),
    folder('Travel'),
    folder('Trash', '\\Trash'),
  ],
};

const smartInboxes: SmartInbox[] = (['Newsletters', 'Receipts & orders', 'Travel'] as const).map(
  (name, index) => {
    const template = SMART_INBOX_TEMPLATES.find((candidate) => candidate.name === name)!;
    return {
      id: `demo-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      name: template.name,
      rule: template.rule,
      skipInbox: template.skipInbox,
      excludedSenders: [],
      createdAt: new Date(Date.UTC(2026, 0, 12, 9, index)).toISOString(),
    };
  },
);
const [newslettersInbox, receiptsInbox, travelInbox] = smartInboxes;

const person = (name: string, address: string): MailAddressSummary => ({ name, address });
const alexStudio = person('Alex Morgan', demoAccounts.studio.email);
const alexPersonal = person('Alex Morgan', demoAccounts.personal.email);
const maya = person('Maya Chen', 'maya@northstar.example');
const priya = person('Priya Shah', 'priya@northstar.example');
const jon = person('Jon Bell', 'jon@fieldnotes.example');
const daniela = person('Daniela Ortiz', 'daniela@halcyon-coffee.example');
const sam = person('Sam Rivera', 'sam.rivera@mail.example');
const lena = person('Lena Fischer', 'lena@bookclub.example');

const pdf = (filename: string, size: number): MailAttachmentSummary => ({
  filename, contentType: 'application/pdf', size, related: false,
});

interface DemoSeed {
  key: string;
  account: DemoAccountKey;
  folder: string;
  from: MailAddressSummary;
  to: MailAddressSummary[];
  cc?: MailAddressSummary[];
  subject: string;
  text: string;
  html?: string;
  minutesAgo: number;
  /** Key of the message this one replies to. */
  replyTo?: string;
  unread?: boolean;
  flagged?: boolean;
  dueInDays?: number;
  color?: EmzeroMessageColor;
  attachments?: MailAttachmentSummary[];
  insights?: {
    category: MailCategory;
    needsReply?: boolean;
    urgent?: boolean;
    smartInboxes?: SmartInbox[];
  };
}

const minutes = 1;
const hours = 60;
const days = 24 * hours;

const newsletterHtml = `
<div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1c1917;">
  <p style="font: 600 12px/1.4 -apple-system, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #78716c;">Issue 142 · Design Systems Weekly</p>
  <h1 style="font-size: 28px; line-height: 1.2; margin: 8px 0 16px;">Quiet interfaces are having a moment</h1>
  <p style="font-size: 17px; line-height: 1.6;">This week: why the best tools are getting calmer, a deep dive into keyboard-first navigation, and three teams who deleted half their settings screens and never looked back.</p>
  <h2 style="font-size: 19px; margin: 28px 0 8px;">1. The case for fewer notifications</h2>
  <p style="font-size: 16px; line-height: 1.6;">Interruptions cost more than they look. We compare five products that batch, summarize, or simply stay silent until it matters.</p>
  <h2 style="font-size: 19px; margin: 28px 0 8px;">2. Keyboard-first, mouse-friendly</h2>
  <p style="font-size: 16px; line-height: 1.6;">A practical checklist for shortcuts that people actually learn, from discoverable hints to forgiving undo.</p>
  <h2 style="font-size: 19px; margin: 28px 0 8px;">3. Typography that breathes</h2>
  <p style="font-size: 16px; line-height: 1.6;">Line length, rhythm, and why your reading pane deserves the same care as your landing page.</p>
  <p style="font: 13px/1.5 -apple-system, sans-serif; color: #78716c; margin-top: 32px;">You are receiving this because you subscribed at designsystems.example. Unsubscribe any time.</p>
</div>`;

const seeds: DemoSeed[] = [
  // Northstar Studio — Inbox
  {
    key: 'launch-review', account: 'studio', folder: 'Inbox', from: maya, to: [alexStudio],
    cc: [priya], subject: 'The launch page is ready for review', minutesAgo: 24 * minutes,
    unread: true, flagged: true, dueInDays: 1, attachments: [pdf('launch-checklist.pdf', 248_000)],
    insights: { category: 'personal', needsReply: true, urgent: true },
    text: `Hey Alex,

I wrapped up the final responsive pass and added the new product shots. Everything is staged and ready for your review — the mobile layout feels especially crisp now.

Two things I'd love your eyes on:
• The pricing table copy (I shortened the feature list)
• The hero animation timing on slower laptops

The launch checklist is attached so we can close out the last details tomorrow morning.

Maya`,
  },
  {
    key: 'early-access-invite', account: 'studio', folder: 'Sent', from: alexStudio, to: [jon],
    subject: 'Early access invite', minutesAgo: 2 * days + 3 * hours,
    text: `Hi Jon,

We're opening Emzero to a handful of people before launch and I immediately thought of you. It brings all your inboxes into one calm, keyboard-first place.

Want in? I'd love your honest feedback after a week.

Alex`,
  },
  {
    key: 'early-access-reply', account: 'studio', folder: 'Inbox', from: jon, to: [alexStudio],
    subject: 'Re: Early access invite', replyTo: 'early-access-invite', minutesAgo: 58 * minutes,
    unread: true, insights: { category: 'personal', needsReply: true },
    text: `Count me in! The unified inbox is exactly what I've been looking for — I'm juggling three accounts right now and it's chaos.

Happy to share notes after a week. Do you want feedback in a doc or just a call?

Jon

Alex Morgan wrote:
> We're opening Emzero to a handful of people before launch and I immediately thought of you.`,
  },
  {
    key: 'roadmap', account: 'studio', folder: 'Inbox', from: priya, to: [alexStudio, maya],
    subject: 'Q4 roadmap notes', minutesAgo: 5 * hours, color: 'purple',
    insights: { category: 'personal' },
    text: `Hi both,

Here are the themes we agreed on after the planning session:

1. Focus — fewer, better features
2. Speed — every action under 100 ms
3. A calmer first-run experience

I'll turn these into milestones by Friday. Shout if I missed anything.

Priya`,
  },
  {
    key: 'roadmap-reply', account: 'studio', folder: 'Sent', from: alexStudio, to: [priya],
    cc: [maya], subject: 'Re: Q4 roadmap notes', replyTo: 'roadmap', minutesAgo: 4 * hours,
    text: `Looks great, Priya. One addition: let's make offline mode part of "speed" — it keeps coming up in interviews.

Alex`,
  },
  {
    key: 'sprint-review', account: 'studio', folder: 'Inbox', from: priya, to: [alexStudio],
    subject: 'Invitation: Sprint review — Thursday 10:00', minutesAgo: 7 * hours, unread: true,
    insights: { category: 'notification' },
    text: `Priya Shah invited you to "Sprint review".

When: Thursday 10:00 – 10:45
Where: Studio, big table (and video link)

Agenda: launch readiness, roadmap milestones, demo of the new reader.`,
  },
  {
    key: 'payout', account: 'studio', folder: 'Inbox', from: person('Ledger Pay', 'payouts@ledger.example'),
    to: [alexStudio], subject: 'Your payout of €4,820.00 is on the way', minutesAgo: 20 * hours,
    insights: { category: 'transactional', smartInboxes: [receiptsInbox] },
    text: `Good news — a payout of €4,820.00 to your account ending in 0042 is on its way and should arrive within 2 business days.

Payout ID: po_demo_1842
Invoices included: 3`,
  },
  {
    key: 'deploy', account: 'studio', folder: 'Inbox', from: person('Shipyard CI', 'builds@shipyard.example'),
    to: [alexStudio], subject: 'Deploy succeeded: northstar-web #482', minutesAgo: 9 * hours,
    insights: { category: 'notification' },
    text: `Production deploy #482 of northstar-web finished in 1m 42s.

Commit: "Tighten hero spacing on small screens" by Maya Chen
All 214 checks passed.`,
  },
  {
    key: 'newsletter', account: 'studio', folder: 'Inbox', from: person('Design Systems Weekly', 'issue@designsystems.example'),
    to: [alexStudio], subject: 'Quiet interfaces are having a moment', minutesAgo: 1 * days + 2 * hours,
    unread: true, html: newsletterHtml,
    insights: { category: 'newsletter', smartInboxes: [newslettersInbox] },
    text: 'Issue 142 · Design Systems Weekly. Quiet interfaces are having a moment. This week: why the best tools are getting calmer, a deep dive into keyboard-first navigation, and three teams who deleted half their settings screens.',
  },
  {
    key: 'proposal', account: 'studio', folder: 'Sent', from: alexStudio, to: [daniela],
    subject: 'Proposal: Halcyon brand refresh', minutesAgo: 6 * days,
    attachments: [pdf('halcyon-proposal.pdf', 1_240_000)],
    text: `Hi Daniela,

Thanks again for the great conversation. Attached is our proposal for the brand refresh, including timeline and two rounds of revisions.

Looking forward to your thoughts.

Alex`,
  },
  {
    key: 'brand-feedback', account: 'studio', folder: 'Inbox', from: daniela, to: [alexStudio],
    subject: 'Re: Proposal: Halcyon brand refresh', replyTo: 'proposal', minutesAgo: 2 * days,
    flagged: true, color: 'orange', attachments: [pdf('round-2-feedback.pdf', 412_000)],
    insights: { category: 'personal', needsReply: true },
    text: `Hi Alex,

The team loved round two! A few notes are in the attached PDF — mostly small tweaks to the wordmark spacing and the warmer palette.

Could we get the final files by the end of next week? We'd like to print the new cups for the spring menu.

Thanks so much,
Daniela`,
  },
  {
    key: 'brand-feedback-draft', account: 'studio', folder: 'Drafts', from: alexStudio, to: [daniela],
    subject: 'Re: Proposal: Halcyon brand refresh', replyTo: 'brand-feedback', minutesAgo: 3 * hours,
    text: `Hi Daniela,

So glad the team liked it! End of next week works for us. I'll send over the final files on`,
  },

  // Northstar Studio — other folders
  {
    key: 'press-kit', account: 'studio', folder: 'Launch', from: maya, to: [alexStudio],
    subject: 'Press kit — final assets', minutesAgo: 1 * days + 5 * hours, unread: true,
    attachments: [pdf('press-kit.pdf', 3_480_000)],
    text: 'Final logos, screenshots, and the founder bio are all in the press kit. Let me know if the press team needs other formats.',
  },
  {
    key: 'run-of-show', account: 'studio', folder: 'Launch', from: priya, to: [alexStudio, maya],
    subject: 'Launch day run-of-show', minutesAgo: 3 * days, unread: true,
    text: `08:00 Final smoke test
09:00 Flip the waitlist to open sign-ups
09:15 Announcement post + newsletter
12:00 Lunch (seriously, eat something)
16:00 Metrics check-in`,
  },
  {
    key: 'fieldnotes-kickoff', account: 'studio', folder: 'Clients/Fieldnotes', from: jon, to: [alexStudio],
    subject: 'Kickoff agenda', minutesAgo: 9 * days,
    text: 'Here is the agenda for our kickoff: goals, constraints, research plan, and timeline. See you Monday!',
  },
  {
    key: 'halcyon-contract', account: 'studio', folder: 'Clients/Halcyon Coffee', from: daniela, to: [alexStudio],
    subject: 'Signed contract', minutesAgo: 12 * days, attachments: [pdf('halcyon-contract-signed.pdf', 520_000)],
    text: 'Signed and attached. We are so excited to get started!',
  },
  {
    key: 'welcome-maya', account: 'studio', folder: 'Archive', from: alexStudio, to: [maya],
    subject: 'Welcome to the team, Maya!', minutesAgo: 40 * days,
    text: 'So happy to have you on board. Your laptop arrives Monday — first coffee is on me.',
  },
  {
    key: 'conference-promo', account: 'studio', folder: 'Trash', from: person('Interface Conf', 'tickets@interfaceconf.example'),
    to: [alexStudio], subject: 'Last chance: 40% off conference tickets', minutesAgo: 4 * days,
    text: 'Early-bird pricing ends tonight. Grab your ticket before it is gone.',
  },

  // Personal — Inbox
  {
    key: 'coffee', account: 'personal', folder: 'Inbox', from: sam, to: [alexPersonal],
    subject: 'Coffee next week?', minutesAgo: 47 * minutes, unread: true,
    insights: { category: 'personal', needsReply: true },
    text: `I'll be nearby on Thursday. Want to try that new place on Oak Street? I hear their cardamom buns are worth the trip.

Sam`,
  },
  {
    key: 'flight', account: 'personal', folder: 'Inbox', from: person('Northwind Air', 'trips@northwind.example'),
    to: [alexPersonal], subject: 'Your trip to Lisbon: check-in opens tomorrow', minutesAgo: 3 * hours,
    unread: true, flagged: true, dueInDays: 1,
    insights: { category: 'transactional', urgent: true, smartInboxes: [travelInbox] },
    text: `Hi Alex,

Online check-in for flight NW 218 to Lisbon opens tomorrow at 07:40.

Departure: Friday, 07:40 · Gate opens 06:55
Seat: 14A (window)
Booking reference: DEMO42

Have a great trip!`,
  },
  {
    key: 'book-club', account: 'personal', folder: 'Inbox', from: lena, to: [alexPersonal],
    subject: 'Book club: November pick', minutesAgo: 2 * days + 4 * hours,
    insights: { category: 'personal' },
    text: `Hi everyone!

Vote for November's book by Sunday:
1. A slow, beautiful novel about lighthouse keepers
2. The one about the octopus everyone keeps recommending
3. Something short, because December is busy

Lena`,
  },
  {
    key: 'book-club-reply', account: 'personal', folder: 'Sent', from: alexPersonal, to: [lena],
    subject: 'Re: Book club: November pick', replyTo: 'book-club', minutesAgo: 2 * days,
    text: 'Octopus, obviously. 🐙 I can host this time!',
  },
  {
    key: 'shipped', account: 'personal', folder: 'Inbox', from: person('Kestrel Outfitters', 'orders@kestrel.example'),
    to: [alexPersonal], subject: 'Your order has shipped', minutesAgo: 1 * days,
    insights: { category: 'transactional', smartInboxes: [receiptsInbox] },
    text: `Your rain jacket (Fjord Blue, M) is on its way.

Tracking number: KO-DEMO-77120
Expected delivery: Thursday`,
  },
  {
    key: 'hosting-receipt', account: 'personal', folder: 'Inbox', from: person('Acme Hosting', 'billing@acme-hosting.example'),
    to: [alexPersonal], subject: 'Receipt for your October subscription', minutesAgo: 2 * days + 6 * hours,
    attachments: [pdf('receipt-october.pdf', 64_000)],
    insights: { category: 'transactional', smartInboxes: [receiptsInbox] },
    text: 'Thanks for your payment of €12.00. Your receipt is attached for your records.',
  },
  {
    key: 'statement', account: 'personal', folder: 'Inbox', from: person('Harbor Bank', 'statements@harborbank.example'),
    to: [alexPersonal], subject: 'Your monthly statement is ready', minutesAgo: 3 * days, color: 'green',
    insights: { category: 'official' },
    text: 'Your statement for October is now available in online banking. No action is needed.',
  },
  {
    key: 'long-read', account: 'personal', folder: 'Inbox', from: person('The Sunday Long Read', 'hello@longread.example'),
    to: [alexPersonal], subject: 'This week: the people who map the ocean floor', minutesAgo: 1 * days + 10 * hours,
    unread: true, insights: { category: 'newsletter', smartInboxes: [newslettersInbox] },
    text: 'Five stories worth your Sunday: the people who map the ocean floor, a love letter to night trains, and more.',
  },

  // Personal — other folders
  {
    key: 'hotel', account: 'personal', folder: 'Travel', from: person('Casa Azulejo', 'stay@casa-azulejo.example'),
    to: [alexPersonal], subject: 'Booking confirmed: 3 nights in Lisbon', minutesAgo: 14 * days,
    attachments: [pdf('booking-confirmation.pdf', 98_000)],
    text: 'Your room is booked for 3 nights. Check-in from 15:00. We look forward to welcoming you!',
  },
  {
    key: 'old-receipt', account: 'personal', folder: 'Receipts', from: person('Acme Hosting', 'billing@acme-hosting.example'),
    to: [alexPersonal], subject: 'Receipt for your September subscription', minutesAgo: 32 * days,
    attachments: [pdf('receipt-september.pdf', 63_000)],
    text: 'Thanks for your payment of €12.00. Your receipt is attached for your records.',
  },
  {
    key: 'toast-draft', account: 'personal', folder: 'Drafts', from: alexPersonal, to: [alexPersonal],
    subject: 'Wedding toast — draft v2', minutesAgo: 6 * days,
    text: 'When I first met Jamie, they were trying to fix a bicycle with a spoon…',
  },
];

function messageId(key: string): string {
  return `<${key}@demo.emzero.invalid>`;
}

function references(seed: DemoSeed): string[] {
  if (!seed.replyTo) return [];
  const parent = seeds.find((candidate) => candidate.key === seed.replyTo)!;
  return [...references(parent), messageId(parent.key)];
}

function seedMessages(now: number): void {
  for (const key of Object.keys(demoAccounts) as DemoAccountKey[]) {
    const account = demoAccounts[key];
    mailCache().replaceFolders(account.id, demoFolders[key]);
    for (const { path: folderPath } of demoFolders[key]) {
      const folderSeeds = seeds
        .filter((seed) => seed.account === key && seed.folder === folderPath)
        .sort((left, right) => right.minutesAgo - left.minutesAgo);
      const stored = storeDemoMessages(account.id, folderPath, folderSeeds.map((seed) => {
        const sentAt = new Date(now - seed.minutesAgo * 60_000).toISOString();
        const threadReferences = references(seed);
        return {
          summary: {
            messageId: messageId(seed.key),
            inReplyTo: threadReferences.at(-1) ?? null,
            references: threadReferences,
            subject: seed.subject,
            from: [seed.from],
            to: seed.to,
            sentAt,
            receivedAt: sentAt,
            unread: Boolean(seed.unread),
            flagged: Boolean(seed.flagged),
            important: seed.dueInDays !== undefined,
            dueDate: seed.dueInDays === undefined ? null : localDateKeyAfter(seed.dueInDays, new Date(now)),
            color: seed.color ?? null,
            size: (seed.html ?? seed.text).length + (seed.attachments ?? []).reduce((sum, file) => sum + file.size, 0),
          },
          detail: {
            messageId: messageId(seed.key),
            subject: seed.subject,
            from: [seed.from],
            to: seed.to,
            cc: seed.cc ?? [],
            replyTo: [seed.from],
            sentAt,
            text: seed.text,
            html: seed.html ?? null,
            htmlHasQuotedText: false,
            attachments: seed.attachments ?? [],
          },
        };
      }));
      folderSeeds.forEach((seed, index) => {
        if (!seed.insights) return;
        const { category, needsReply, urgent, smartInboxes: matches = [] } = seed.insights;
        mailCache().putMessageInsights(
          account.id,
          folderPath,
          stored[index].uid,
          stored[index].messageId,
          {
            category,
            categoryConfidence: 0.94,
            needsReply: needsReply ? 0.91 : 0.06,
            urgency: urgent ? 1.8 : 0.2,
            urgencyConfidence: 0.85,
          },
          Object.fromEntries(smartInboxes.map((inbox) => [inbox.id, matches.includes(inbox) ? 0.96 : 0.03])),
        );
      });
    }
  }
}

/** Replaces the demo profile's mail, accounts, and settings with a fresh sample mailbox. */
export async function seedDemoProfile(): Promise<void> {
  closeMailCache();
  const userData = app.getPath('userData');
  await Promise.all(
    ['mail-cache.sqlite', 'mail-cache.sqlite-wal', 'mail-cache.sqlite-shm'].map((file) =>
      rm(path.join(userData, file), { force: true }),
    ),
  );
  await writeAccounts(Object.values(demoAccounts));
  await writeSmartInboxSettings({ enabled: true, inboxes: smartInboxes });
  await writeSignatures([
    {
      id: 'demo-studio-signature',
      name: 'Studio',
      body: 'Alex Morgan\nFounder, Northstar Studio\nnorthstar.example',
      accountIds: [demoAccounts.studio.id],
    },
    {
      id: 'demo-personal-signature',
      name: 'Personal',
      body: 'Alex',
      accountIds: [demoAccounts.personal.id],
    },
  ]);
  seedMessages(Date.now());
}
