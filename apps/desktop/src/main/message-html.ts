import sanitizeHtml from 'sanitize-html';

const color = String.raw`(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.%\s,/]+\)|[a-z]+)`;
const length = String.raw`(?:auto|0|\d+(?:\.\d+)?(?:px|em|rem|%|pt))`;
const safeColor = new RegExp(`^${color}$`, 'i');
const safeLength = new RegExp(`^${length}$`, 'i');
const safeBorder = new RegExp(
  String.raw`^(?:none|0|[\d.]+(?:px|pt)?\s+(?:none|solid|dashed|dotted|double)(?:\s+${color})?)$`,
  'i',
);
const safeBorderRadius = new RegExp(String.raw`^${length}(?:\s+${length}){0,3}$`, 'i');

function restoreEscapedLegacyFormatting(value: string): string {
  // Some webmail clients double-escape the legacy <font>/<br> fragment they
  // prepend to replies. Restore only those inert formatting tags, then pass
  // the result through the normal sanitizer below.
  return value.replace(/&lt;(\/?(?:font\b[\s\S]*?|br\s*\/?))&gt;/gi, '<$1>');
}

export function sanitizedMessageHtml(value: string | false): string | null {
  if (!value) return null;
  return sanitizeHtml(restoreEscapedLegacyFormatting(value), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {
      '*': ['style'],
      a: ['href'],
      blockquote: ['type', 'class'],
      div: ['class', 'id'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['cellpadding', 'cellspacing', 'width', 'align', 'bgcolor'],
      tr: ['align', 'valign', 'bgcolor'],
      td: ['colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'bgcolor'],
      th: ['colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'bgcolor'],
    },
    // Keep remote image URLs in the sanitized document so the renderer can
    // offer an explicit "load images" action. Its CSP blocks them by default.
    allowedSchemesByTag: {
      a: ['http', 'https'],
      img: ['data', 'http', 'https'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowedStyles: {
      '*': {
        color: [safeColor],
        // Only the color form of the shorthand: email buttons commonly use
        // `background:#111827`, while url() values stay blocked.
        background: [safeColor],
        'background-color': [safeColor],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-size': [safeLength],
        'font-style': [/^(?:normal|italic|oblique)$/],
        'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/],
        'line-height': [/^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%|pt)?)$/],
        'text-align': [/^(?:left|right|center|justify)$/],
        'text-decoration': [/^(?:none|underline|line-through)$/],
        'vertical-align': [/^(?:baseline|middle|top|bottom|text-top|text-bottom)$/],
        display: [/^(?:block|inline|inline-block|table|table-row|table-cell|none)$/],
        width: [safeLength],
        'max-width': [safeLength],
        height: [safeLength],
        margin: [/^[\d.%a-z\s-]+$/i],
        'margin-top': [safeLength],
        'margin-right': [safeLength],
        'margin-bottom': [safeLength],
        'margin-left': [safeLength],
        padding: [/^[\d.%a-z\s-]+$/i],
        'padding-top': [safeLength],
        'padding-right': [safeLength],
        'padding-bottom': [safeLength],
        'padding-left': [safeLength],
        border: [safeBorder],
        'border-top': [safeBorder],
        'border-right': [safeBorder],
        'border-bottom': [safeBorder],
        'border-left': [safeBorder],
        'border-color': [safeColor],
        'border-radius': [safeBorderRadius],
        'border-collapse': [/^(?:collapse|separate)$/],
      },
    },
  }).trim();
}

export function hasQuotedHtml(value: string | false): boolean {
  if (!value) return false;
  return /<blockquote\b|\b(?:gmail_quote|yahoo_quoted|moz-cite-prefix|divRplyFwdMsg)\b/i.test(
    value,
  );
}
