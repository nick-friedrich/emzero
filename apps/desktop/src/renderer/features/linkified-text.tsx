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
