import { Fragment } from 'react';

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string };

const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const trailingPunctuation = /[.,;:!?'*_~]$/;
const closingToOpening: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function count(value: string, character: string): number {
  return value.split(character).length - 1;
}

/** Drops sentence punctuation and unbalanced closing brackets that follow a URL in prose. */
function trimUrl(candidate: string): string {
  let url = candidate;
  for (;;) {
    const last = url.at(-1) ?? '';
    const opening = closingToOpening[last];
    if (trailingPunctuation.test(url) || (opening && count(url, last) > count(url, opening))) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

/** Splits plain text into text and http(s) link segments. Bare `www.` hosts link to https. */
export function linkifyText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const start = match.index;
    const linkText = trimUrl(match[0]);
    const url = /^www\./i.test(linkText) ? `https://${linkText}` : linkText;
    if (!URL.canParse(url) || linkText.length <= 'www.'.length) continue;
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    segments.push({ kind: 'link', text: linkText, url });
    cursor = start + linkText.length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

const htmlEntities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

function decodeHtmlText(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot);/g, (entity) => htmlEntities[entity] ?? entity);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[character]};`);
}

/**
 * Wraps bare URLs in sanitized message HTML with `<a>` so they open like
 * authored links. Expects sanitizer output, where text and attribute values
 * have `<`, `>`, `&`, and `"` escaped, so splitting on tags is reliable.
 * Text already inside an `<a>` is left alone.
 */
export function linkifyHtml(html: string): string {
  let anchorDepth = 0;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<a\b/i.test(part)) anchorDepth += 1;
        else if (/^<\/a\s*>/i.test(part)) anchorDepth = Math.max(0, anchorDepth - 1);
        return part;
      }
      if (anchorDepth > 0 || !/https?:\/\/|www\./i.test(part)) return part;
      return linkifyText(decodeHtmlText(part))
        .map((segment) =>
          segment.kind === 'text'
            ? escapeHtml(segment.text)
            : `<a href="${escapeHtml(segment.url)}">${escapeHtml(segment.text)}</a>`,
        )
        .join('');
    })
    .join('');
}

export function LinkifiedText({ text, onOpenLink }: { text: string; onOpenLink: (url: string) => void }) {
  return linkifyText(text).map((segment, index) =>
    segment.kind === 'text' ? (
      <Fragment key={index}>{segment.text}</Fragment>
    ) : (
      <a
        key={index}
        href={segment.url}
        className="text-primary underline underline-offset-2 hover:opacity-80"
        onClick={(event) => {
          event.preventDefault();
          onOpenLink(segment.url);
        }}
      >
        {segment.text}
      </a>
    ),
  );
}
