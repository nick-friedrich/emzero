import type { MailAddressSummary, MailMessageDetail } from '../../shared/accounts';

function addresses(values: MailAddressSummary[]): string {
  return values.map(({ name, address }) => name && address ? `${name} <${address}>` : address || name || 'Unknown')
    .join(', ') || 'None';
}

function date(value: string | null): string {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function bodyText(message: MailMessageDetail): string {
  const text = message.text.trim();
  if (text !== 'This message has no readable text content.' || !message.html ||
    typeof DOMParser === 'undefined') return text;
  const document = new DOMParser().parseFromString(message.html, 'text/html');
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return '';
    if (node.tagName === 'BR') return '\n';
    const content = [...node.childNodes].map(read).join('');
    return /^(P|DIV|LI|TR|BLOCKQUOTE)$/.test(node.tagName) ? `${content}\n` : content;
  };
  return [...document.body.childNodes].map(read).join('').replace(/\n{3,}/g, '\n\n').trim() || text;
}

export function formatConversationForCopy(subject: string, messages: MailMessageDetail[]): string {
  return [
    `Conversation: ${subject}`,
    `Messages: ${messages.length}`,
    ...messages.map((message, index) => [
      '',
      '---',
      `Message ${index + 1} of ${messages.length}`,
      `Date: ${date(message.sentAt)}`,
      `From: ${addresses(message.from)}`,
      `To: ${addresses(message.to)}`,
      ...(message.cc.length ? [`Cc: ${addresses(message.cc)}`] : []),
      `Subject: ${message.subject}`,
      ...(message.attachments.filter((attachment) => !attachment.related).length
        ? [`Attachments (files not included): ${message.attachments.filter((attachment) => !attachment.related)
          .map((attachment) => attachment.filename).join(', ')}`]
        : []),
      '',
      bodyText(message),
    ].join('\n')),
  ].join('\n').trim();
}
