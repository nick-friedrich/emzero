import type {
  AccountSummary,
  MailAddressSummary,
  MailMessageDetail,
  MailMessageSummary,
  MailReplyDraft,
  MailSendDraft,
} from './accounts.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizedAddress(value: MailAddressSummary): string {
  return value.address?.trim().toLowerCase() ?? '';
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim() || '(No subject)';
  return /^re\s*:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function replyRecipients(
  account: AccountSummary,
  message: Pick<MailMessageDetail, 'from' | 'to' | 'replyTo'>,
): MailAddressSummary[] {
  const ownAddresses = new Set(
    [account.email, account.username].map((value) => value.trim().toLowerCase()),
  );
  const preferred = message.replyTo.length > 0 ? message.replyTo : message.from;
  const candidates = preferred.some((address) => {
    const normalized = normalizedAddress(address);
    return normalized && !ownAddresses.has(normalized);
  })
    ? preferred
    : message.to;

  return [...new Map(
    candidates
      .filter((address) => {
        const normalized = normalizedAddress(address);
        return emailPattern.test(normalized) && !ownAddresses.has(normalized);
      })
      .map((address) => [normalizedAddress(address), address]),
  ).values()];
}

export function createReplyDraft(
  account: AccountSummary,
  summary: MailMessageSummary,
  detail: MailMessageDetail,
  text: string,
): MailReplyDraft {
  return {
    to: replyRecipients(account, detail),
    cc: [],
    bcc: [],
    subject: replySubject(detail.subject),
    text,
    inReplyTo: detail.messageId,
    references: [...new Set([...summary.references, detail.messageId].filter(Boolean) as string[])],
    attachments: [],
  };
}

export function parseAddressList(value: string): MailAddressSummary[] {
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const named = entry.match(/^(?:"([^"]+)"|([^<>]+?))?\s*<([^<>]+)>$/);
      return named
        ? { name: (named[1] ?? named[2])?.trim() || null, address: named[3].trim() }
        : { name: null, address: entry };
    });
}

export function validateSendDraft(draft: MailSendDraft): string | null {
  if (draft.to.length === 0) return 'Enter at least one recipient.';
  for (const [label, addresses] of [
    ['To', draft.to],
    ['Cc', draft.cc],
    ['Bcc', draft.bcc],
  ] as const) {
    if (
      addresses.some(
        ({ address }) => !address || !emailPattern.test(address.trim()) || /[\r\n]/.test(address),
      )
    ) {
      return `${label} contains an invalid email address.`;
    }
  }
  if (!draft.subject.trim() || /[\r\n]/.test(draft.subject)) return 'Enter a valid subject.';
  if (!draft.text.trim()) return 'Write a message before sending.';
  if (draft.inReplyTo && /[\r\n]/.test(draft.inReplyTo)) return 'The message headers are invalid.';
  if (draft.references.some((reference) => /[\r\n]/.test(reference))) {
    return 'The message headers are invalid.';
  }
  if (draft.attachments.length > 20) return 'Attach no more than 20 files.';
  if (draft.attachments.reduce((total, attachment) => total + attachment.size, 0) > 50 * 1024 * 1024) {
    return 'Attachments cannot exceed 50 MB in total.';
  }
  return null;
}

export function validateReplyDraft(draft: MailReplyDraft): string | null {
  if (draft.to.length === 0) return 'This message has no valid reply address.';
  const error = validateSendDraft(draft);
  return error === 'Enter a valid subject.' ? 'The subject is invalid.' : error;
}
