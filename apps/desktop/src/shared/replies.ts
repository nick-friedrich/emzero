import type {
  AccountSummary,
  MailAddressSummary,
  MailMessageDetail,
  MailMessageSummary,
  MailReplyDraft,
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
    subject: replySubject(detail.subject),
    text,
    inReplyTo: detail.messageId,
    references: [...new Set([...summary.references, detail.messageId].filter(Boolean) as string[])],
  };
}

export function validateReplyDraft(draft: MailReplyDraft): string | null {
  if (draft.to.length === 0) return 'This message has no valid reply address.';
  if (
    draft.to.some(
      ({ address }) => !address || !emailPattern.test(address.trim()) || /[\r\n]/.test(address),
    )
  ) {
    return 'The reply address is invalid.';
  }
  if (!draft.subject.trim() || /[\r\n]/.test(draft.subject)) return 'The subject is invalid.';
  if (!draft.text.trim()) return 'Write a message before sending.';
  if (draft.inReplyTo && /[\r\n]/.test(draft.inReplyTo)) return 'The reply headers are invalid.';
  if (draft.references.some((reference) => /[\r\n]/.test(reference))) {
    return 'The reply headers are invalid.';
  }
  return null;
}
