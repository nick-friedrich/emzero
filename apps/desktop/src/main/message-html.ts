import sanitizeHtml from 'sanitize-html';

const safeColor = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.%\s,]+\)|[a-z]+)$/i;
const safeLength = /^(?:auto|0|\d+(?:\.\d+)?(?:px|em|rem|%|pt))$/i;

export function sanitizedMessageHtml(value: string | false): string | null {
  if (!value) return null;
  return sanitizeHtml(value, {
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
      blockquote: ['type', 'class'],
      div: ['class', 'id'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['cellpadding', 'cellspacing', 'width'],
      td: ['colspan', 'rowspan', 'width', 'height'],
      th: ['colspan', 'rowspan', 'width', 'height'],
    },
    allowedSchemesByTag: { img: ['data'] },
    allowedSchemesAppliedToAttributes: ['src'],
    allowedStyles: {
      '*': {
        color: [safeColor],
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
        border: [/^[\d.]+(?:px|pt)?\s+(?:none|solid|dashed|dotted)\s+(?:#[\da-f]{3,8}|[a-z]+)$/i],
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
