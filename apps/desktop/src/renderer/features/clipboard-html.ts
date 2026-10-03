/**
 * Clipboard HTML normalization for the composer. Pasted markup is rebuilt from a small set of
 * semantic tags, and inline styles are interpreted rather than trusted, so sources such as
 * Google Docs (which wraps everything in `<b style="font-weight:normal">`) paste as they look.
 */

/** Escape plain text into editor HTML, keeping line breaks. */
export function htmlFromText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\n', '<br>');
}

export interface TextFormatting {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export const plainFormatting: TextFormatting = { bold: false, italic: false, underline: false, strike: false };

const boldTags = new Set(['B', 'STRONG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TH']);
const italicTags = new Set(['I', 'EM', 'CITE']);
const underlineTags = new Set(['U', 'INS']);
const strikeTags = new Set(['S', 'STRIKE', 'DEL']);

function styleValue(style: string, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return match ? match[1].replace(/!important/i, '').trim().toLowerCase() : null;
}

/** The formatting a pasted element shows, given what its ancestors already show. */
export function pastedFormatting(tagName: string, style: string, inherited: TextFormatting): TextFormatting {
  const tag = tagName.toUpperCase();
  const next = {
    bold: inherited.bold || boldTags.has(tag),
    italic: inherited.italic || italicTags.has(tag),
    underline: inherited.underline || underlineTags.has(tag),
    strike: inherited.strike || strikeTags.has(tag),
  };
  const weight = styleValue(style, 'font-weight');
  if (weight) {
    const numeric = Number.parseInt(weight, 10);
    if (weight === 'bold' || weight === 'bolder' || numeric >= 600) next.bold = true;
    else if (weight === 'normal' || weight === 'lighter' || (numeric > 0 && numeric < 600)) next.bold = false;
  }
  const fontStyle = styleValue(style, 'font-style');
  if (fontStyle) next.italic = fontStyle === 'italic' || fontStyle === 'oblique';
  const decoration = styleValue(style, 'text-decoration-line') ?? styleValue(style, 'text-decoration');
  if (decoration) {
    if (decoration.includes('underline')) next.underline = true;
    if (decoration.includes('line-through')) next.strike = true;
  }
  return next;
}

/** Accept typed link targets such as `example.com` or `name@example.com`; reject anything unsafe. */
export function normalizedLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[^@/:]+@[^@/:]+\.[^@/:]+$/.test(trimmed)) return `mailto:${trimmed}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null;
  if (/^[^/]+\.[a-z]{2,}(?:[/?#:].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

const keptTags = new Set(['P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'IMG']);
const paragraphTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
const droppedTags = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'OBJECT', 'IFRAME', 'SVG']);
const formattingTags: [keyof TextFormatting, string][] = [
  ['bold', 'b'], ['italic', 'i'], ['underline', 'u'], ['strike', 's'],
];
export const inlineImagePattern = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+={0,2}$/i;

/** Rebuild clipboard HTML from safe semantic tags. Browser-only: relies on DOMParser. */
export function safeClipboardHtml(html: string): string {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const destination = document.createElement('div');
  const append = (node: Node, parent: Node, formatting: TextFormatting) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''));
      return;
    }
    if (!(node instanceof Element) || droppedTags.has(node.tagName)) return;
    let target: Node = parent;
    if (keptTags.has(node.tagName) || paragraphTags.has(node.tagName)) {
      const element = document.createElement(keptTags.has(node.tagName) ? node.tagName.toLowerCase() : 'p');
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? '';
        if (/^(https?:|mailto:)/i.test(href)) (element as HTMLAnchorElement).href = href;
      }
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') ?? '';
        if (!inlineImagePattern.test(src)) return;
        (element as HTMLImageElement).src = src;
        (element as HTMLImageElement).alt = node.getAttribute('alt') ?? '';
      }
      parent.appendChild(element);
      target = element;
    }
    const next = pastedFormatting(node.tagName, node.getAttribute('style') ?? '', formatting);
    for (const [key, tag] of formattingTags) {
      if (next[key] && !formatting[key]) {
        const wrapper = document.createElement(tag);
        target.appendChild(wrapper);
        target = wrapper;
      }
    }
    for (const child of node.childNodes) append(child, target, next);
    if (node.tagName === 'TD' || node.tagName === 'TH') parent.appendChild(document.createTextNode(' '));
  };
  for (const child of source.body.childNodes) append(child, destination, plainFormatting);
  return destination.innerHTML;
}
