import type { MailAddressSummary, MailMessageSummary } from './accounts.js';

// Every question Jev is asked and every threshold the app acts on lives in this
// file so the AI behavior can be reviewed and tuned in one place.

export const JEV_DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';

/** Newest Inbox messages per account that are classified; older mail is left alone. */
export const INSIGHTS_RECENT_MESSAGE_LIMIT = 200;
/** A smart-inbox rule matches when Jev's yes-probability reaches this value. */
export const RULE_MATCH_THRESHOLD = 0.7;
export const CATEGORY_TAG_MIN_CONFIDENCE = 0.6;
export const NEEDS_REPLY_TAG_THRESHOLD = 0.8;
/** Urgency is scored 0–2; only near-top scores with a confident answer are shown. */
export const URGENT_TAG_MIN_SCORE = 1.5;
export const URGENT_TAG_MIN_CONFIDENCE = 0.5;

export const MAIL_CATEGORIES = {
  newsletter: {
    label: 'Newsletter',
    criteria: 'Editorial content sent to a subscriber list (articles, digests)',
  },
  promotion: { label: 'Promotion', criteria: 'Marketing, sales, discounts, ads' },
  transactional: {
    label: 'Receipt',
    criteria: 'Receipts, orders, shipping, bookings, invoices, account notices',
  },
  notification: {
    label: 'Notification',
    criteria: 'Automated alerts from tools and services (CI, social, calendar)',
  },
  personal: { label: 'Personal', criteria: 'Written by a person to the recipient individually' },
  official: {
    label: 'Official',
    criteria: 'Government, tax, bank, legal, or insurance communication',
  },
} as const;

export type MailCategory = keyof typeof MAIL_CATEGORIES;

export function isMailCategory(value: unknown): value is MailCategory {
  return typeof value === 'string' && Object.hasOwn(MAIL_CATEGORIES, value);
}

type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export const BASE_INSIGHT_QUESTIONS = {
  category: {
    type: 'choice',
    instructions: 'What kind of email is this?',
    criteria: Object.fromEntries(
      Object.entries(MAIL_CATEGORIES).map(([key, { criteria }]) => [key, criteria]),
    ),
  },
  needs_reply: {
    type: 'noul',
    instructions: 'Does the recipient personally need to do something or reply?',
    criteria: {
      true: 'A person, obligation, or problem requires the recipient to act or respond',
      false: 'Informational, or only an optional offer, sale, or marketing call-to-action',
    },
  },
  urgency: {
    type: 'score',
    instructions:
      'How soon must the recipient act on a real obligation in this email? Marketing deadlines and sales do not count.',
    criteria: [
      'No obligation or deadline',
      'Within the next days or weeks',
      'Today or already broken/overdue',
    ],
  },
} satisfies Record<string, JevQuestion>;

export const RULE_QUESTION_PREFIX = 'rule_';

export function smartInboxRuleQuestion(rule: string): JevQuestion {
  return {
    type: 'noul',
    instructions: `Does this email belong in a mailbox described as: "${rule}"?`,
    criteria: {
      true: 'The email clearly fits that description',
      false: 'The email does not fit that description',
    },
  };
}

export interface MessageInsights {
  category: MailCategory | null;
  categoryConfidence: number;
  needsReply: number;
  urgency: number;
  urgencyConfidence: number;
  /** Jev yes-probabilities keyed by smart-inbox id. */
  ruleScores: Record<string, number>;
}

export interface MessageInsightTag {
  kind: 'category' | 'needs-reply' | 'urgent';
  label: string;
}

export function messageInsightTags(insights: MessageInsights | undefined): MessageInsightTag[] {
  if (!insights) return [];
  const tags: MessageInsightTag[] = [];
  if (insights.urgency >= URGENT_TAG_MIN_SCORE && insights.urgencyConfidence >= URGENT_TAG_MIN_CONFIDENCE) {
    tags.push({ kind: 'urgent', label: 'Urgent' });
  }
  if (insights.needsReply >= NEEDS_REPLY_TAG_THRESHOLD) {
    tags.push({ kind: 'needs-reply', label: 'Needs reply' });
  }
  if (insights.category && insights.categoryConfidence >= CATEGORY_TAG_MIN_CONFIDENCE) {
    tags.push({ kind: 'category', label: MAIL_CATEGORIES[insights.category].label });
  }
  return tags;
}

export interface SmartInbox {
  id: string;
  name: string;
  /** Plain-language description of which mail belongs here; sent to Jev as a question. */
  rule: string;
  /** Hide matching mail from the unified Inbox. The server mailbox is never changed. */
  skipInbox: boolean;
  /** Lower-case sender addresses the user removed from this inbox. */
  excludedSenders: string[];
  createdAt: string;
}

export interface SmartInboxSettings {
  enabled: boolean;
  inboxes: SmartInbox[];
}

export interface SmartInboxDraft {
  name: string;
  rule: string;
  skipInbox: boolean;
}

export interface SmartInboxTemplate extends SmartInboxDraft {
  icon: 'newspaper' | 'receipt' | 'plane' | 'landmark' | 'bell';
}

export const SMART_INBOX_TEMPLATES: SmartInboxTemplate[] = [
  {
    icon: 'newspaper',
    name: 'Newsletters',
    rule: 'Newsletters, digests, and marketing or promotional mail',
    skipInbox: true,
  },
  {
    icon: 'receipt',
    name: 'Receipts & orders',
    rule: 'Receipts, order confirmations, shipping updates, and invoices',
    skipInbox: false,
  },
  {
    icon: 'plane',
    name: 'Travel',
    rule: 'Flight, train, hotel, and rental bookings, check-ins, and itineraries',
    skipInbox: false,
  },
  {
    icon: 'landmark',
    name: 'Bills & banking',
    rule: 'Bills, bank and credit card statements, payments, insurance, and tax mail',
    skipInbox: false,
  },
  {
    icon: 'bell',
    name: 'Notifications',
    rule: 'Alerts from apps, developer tools, and social networks (not receipts, orders, shipping, or bookings)',
    skipInbox: false,
  },
];

export const MAX_SMART_INBOXES = 20;
export const MAX_SMART_INBOX_NAME_LENGTH = 60;
export const MAX_SMART_INBOX_RULE_LENGTH = 300;
const MAX_EXCLUDED_SENDERS = 2_000;

export function validateSmartInboxDraft(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Enter a name and a description.';
  const draft = value as Partial<SmartInboxDraft>;
  if (typeof draft.name !== 'string' || !draft.name.trim()) return 'Enter a name.';
  if (draft.name.trim().length > MAX_SMART_INBOX_NAME_LENGTH) return 'The name is too long.';
  if (typeof draft.rule !== 'string' || !draft.rule.trim()) {
    return 'Describe which mail belongs in this inbox.';
  }
  if (draft.rule.trim().length > MAX_SMART_INBOX_RULE_LENGTH) return 'The description is too long.';
  if (typeof draft.skipInbox !== 'boolean') return 'Choose whether to hide matches from Inbox.';
  return null;
}

export function sanitizedSmartInboxSettings(value: unknown): SmartInboxSettings {
  if (!value || typeof value !== 'object') return { enabled: false, inboxes: [] };
  const settings = value as { enabled?: unknown; inboxes?: unknown };
  const inboxes = Array.isArray(settings.inboxes)
    ? settings.inboxes.flatMap((candidate): SmartInbox[] => {
        if (!candidate || typeof candidate !== 'object') return [];
        const inbox = candidate as Partial<SmartInbox>;
        if (
          typeof inbox.id !== 'string' ||
          !/^[A-Za-z0-9-]{1,64}$/.test(inbox.id) ||
          validateSmartInboxDraft(inbox) !== null
        ) {
          return [];
        }
        return [{
          id: inbox.id,
          name: inbox.name!.trim(),
          rule: inbox.rule!.trim(),
          skipInbox: inbox.skipInbox!,
          excludedSenders: Array.isArray(inbox.excludedSenders)
            ? [...new Set(inbox.excludedSenders.filter(
                (address): address is string => typeof address === 'string' && address.length <= 320,
              ).map((address) => address.toLowerCase()))].slice(-MAX_EXCLUDED_SENDERS)
            : [],
          createdAt: typeof inbox.createdAt === 'string' ? inbox.createdAt : new Date(0).toISOString(),
        }];
      }).slice(0, MAX_SMART_INBOXES)
    : [];
  return { enabled: settings.enabled === true, inboxes };
}

function senderAddress(from: MailAddressSummary[]): string | null {
  return from[0]?.address?.trim().toLowerCase() || null;
}

export function smartInboxContains(
  inbox: SmartInbox,
  message: Pick<MailMessageSummary, 'from' | 'insights'>,
): boolean {
  const sender = senderAddress(message.from);
  if (sender && inbox.excludedSenders.includes(sender)) return false;
  return (message.insights?.ruleScores[inbox.id] ?? 0) >= RULE_MATCH_THRESHOLD;
}

/** Whether a message is filed into a smart inbox that hides its matches from Inbox. */
export function skipsUnifiedInbox(
  inboxes: readonly SmartInbox[],
  message: Pick<MailMessageSummary, 'from' | 'insights'>,
): boolean {
  return inboxes.some((inbox) => inbox.skipInbox && smartInboxContains(inbox, message));
}

export interface MailInsightsStatus {
  state: 'idle' | 'running' | 'error';
  message?: string;
}

export interface SmartInboxOperationResult {
  ok: boolean;
  message?: string;
  settings?: SmartInboxSettings;
}

export const SMART_INBOX_CHANNELS = {
  getSettings: 'smart-inboxes:get',
  setEnabled: 'smart-inboxes:set-enabled',
  create: 'smart-inboxes:create',
  update: 'smart-inboxes:update',
  remove: 'smart-inboxes:remove',
  excludeSender: 'smart-inboxes:exclude-sender',
  unreadCounts: 'smart-inboxes:unread-counts',
  status: 'smart-inboxes:status',
  changed: 'smart-inboxes:changed',
} as const;
