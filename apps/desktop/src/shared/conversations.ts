import type { MailMessageSummary } from './accounts.js';

export interface MailConversation {
  id: string;
  subject: string;
  messages: MailMessageSummary[];
}

function normalizedMessageId(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function normalizedSubject(value: string): string {
  const subject = value.replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, '').trim();
  return subject || '(No subject)';
}

function timestamp(message: MailMessageSummary): number {
  const value = message.sentAt ?? message.receivedAt;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function groupMessagesIntoConversations(
  messages: MailMessageSummary[],
): MailConversation[] {
  const parents = messages.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  const idOwner = new Map<string, number>();
  messages.forEach((message, index) => {
    const ids = [message.messageId, message.inReplyTo, ...(message.references ?? [])]
      .map(normalizedMessageId)
      .filter((value): value is string => Boolean(value));
    for (const id of new Set(ids)) {
      const owner = idOwner.get(id);
      if (owner === undefined) idOwner.set(id, index);
      else union(index, owner);
    }
  });

  const groups = new Map<number, MailMessageSummary[]>();
  messages.forEach((message, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(message);
    groups.set(root, group);
  });

  return [...groups.values()]
    .map((group) => {
      group.sort((left, right) => timestamp(left) - timestamp(right));
      const latest = group.at(-1)!;
      const first = group[0];
      return {
        id:
          normalizedMessageId(first.references?.[0] ?? first.inReplyTo ?? first.messageId) ??
          `uid:${first.uid}`,
        subject: normalizedSubject(latest.subject),
        messages: group,
      };
    })
    .sort((left, right) => timestamp(right.messages.at(-1)!) - timestamp(left.messages.at(-1)!));
}

export interface QuotedTextParts {
  visible: string;
  quoted: string | null;
}

export function splitQuotedText(value: string): QuotedTextParts {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const markerPatterns = [
    /^On .+wrote:\s*$/i,
    /^Am .+schrieb .+:\s*$/i,
    /^Le .+a écrit\s*:\s*$/i,
    /^El .+escribió:\s*$/i,
    /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}\s*$/i,
    /^_{5,}\s*$/,
    /^>+\s?/,
  ];
  let quotedAt = lines.findIndex((line) => markerPatterns.some((pattern) => pattern.test(line)));
  if (quotedAt < 0) {
    quotedAt = lines.findIndex((line, index) => {
      if (!/^On\s/i.test(line)) return false;
      return [1, 2, 3].some((lineCount) =>
        /wrote:\s*$/i.test(lines.slice(index, index + lineCount).join(' ')),
      );
    });
  }
  if (quotedAt < 0) {
    quotedAt = lines.findIndex(
      (line, index) =>
        /^From:\s+\S/i.test(line) &&
        lines.slice(index + 1, index + 5).some((candidate) => /^(?:Sent|To|Subject):\s+/i.test(candidate)),
    );
  }
  if (quotedAt < 0) return { visible: value.trim(), quoted: null };
  return {
    visible: lines.slice(0, quotedAt).join('\n').trim(),
    quoted: lines.slice(quotedAt).join('\n').trim() || null,
  };
}
