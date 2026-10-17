import type { MailMessageDetail } from '../../shared/accounts';
import { splitQuotedText } from '../../shared/conversations';
import { addressDetails } from './mail-common';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function fullDate(value: string | null): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(date);
}

function headerRow(label: string, value: string): string {
  return `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>`;
}

// Builds a self-contained, script-free document that the main process prints
// to PDF. Earlier messages appear in full, so quoted history is hidden in threads.
export function conversationPdfDocument(
  subject: string,
  messages: MailMessageDetail[],
  loadRemoteImages: boolean,
): string {
  const showQuoted = messages.length === 1;
  const imageSources = loadRemoteImages ? 'data: http: https:' : 'data:';
  const quotedStyle = showQuoted
    ? ''
    : '.body blockquote,.body .gmail_quote,.body .yahoo_quoted,.body .moz-cite-prefix,.body #divRplyFwdMsg{display:none!important}';
  const sections = messages.map((message) => {
    const files = message.attachments.filter((attachment) => !attachment.related);
    const text = showQuoted ? message.text : splitQuotedText(message.text).visible;
    const body = message.html
      ? message.html
      : `<div class="text">${escapeHtml(text.trim())}</div>`;
    return `<section class="message"><table class="headers">${[
      headerRow('From', addressDetails(message.from)),
      headerRow('To', addressDetails(message.to)),
      ...(message.cc.length ? [headerRow('Cc', addressDetails(message.cc))] : []),
      headerRow('Date', fullDate(message.sentAt)),
      ...(messages.length > 1 && message.subject !== subject ? [headerRow('Subject', message.subject)] : []),
      ...(files.length ? [headerRow('Attachments', files.map((file) => file.filename).join(', '))] : []),
    ].join('')}</table><div class="body">${body}</div></section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline';"><title>${escapeHtml(subject)}</title><style>html{background:#fff}body{margin:0;color:#202124;background:#fff;font:13px/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}h1{margin:0 0 16px;font-size:20px;line-height:1.3}.message{padding:14px 0;border-top:1px solid #dadce0}.headers{margin-bottom:12px;border-collapse:collapse;font-size:12px;color:#5f6368}.headers th{padding:1px 12px 1px 0;text-align:left;vertical-align:top;font-weight:600;white-space:nowrap}.headers td{padding:1px 0}.text{white-space:pre-wrap}img{max-width:100%;height:auto;break-inside:avoid}table{max-width:100%}${quotedStyle}</style></head><body><h1>${escapeHtml(subject)}</h1>${sections}</body></html>`;
}
