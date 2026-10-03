import { htmlFromText } from './clipboard-html';
import { signatureSeparator } from './signatures';

/**
 * Signatures are marked the way Outlook marks them: the HTML part wraps the signature in
 * `<div id="Signature">` with no visible divider, while the plain-text part keeps the RFC 3676
 * "-- " delimiter so text-only clients can still detect and collapse it.
 */
export const signatureElementId = 'Signature';

export function signatureHtml(signature: string): string {
  return signature ? `<div id="${signatureElementId}">${htmlFromText(signature)}</div>` : '';
}

/** Editor HTML for plain text that may end in a delimited signature. */
export function messageHtml(text: string, signature: string): string {
  const delimited = signature ? `${signatureSeparator}${signature}` : '';
  if (!delimited || !text.endsWith(delimited)) return htmlFromText(text);
  return `${htmlFromText(text.slice(0, -delimited.length))}<br><br>${signatureHtml(signature)}`;
}

/** The plain-text part: the message, then the "-- " delimiter and the signature block's text. */
export function delimitedText(fullText: string, signatureText: string): string {
  const signature = signatureText.replace(/\n+$/, '');
  const full = fullText.replace(/\n+$/, '');
  if (!signature.trim() || !full.endsWith(signature)) return fullText;
  return `${full.slice(0, -signature.length).replace(/\n+$/, '')}${signatureSeparator}${signature}`;
}

function lastSignatureElement(root: ParentNode): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(`#${signatureElementId}`)].at(-1) ?? null;
}

/** Plain text of a rendered editor, with the signature block delimited. */
export function signatureAwareText(root: HTMLElement): string {
  const block = lastSignatureElement(root);
  return block ? delimitedText(root.innerText, block.innerText) : root.innerText;
}

/** The current signature block's markup, keeping any edits made in the message. */
export function signatureBlock(html: string): string | null {
  const container = document.createElement('div');
  container.innerHTML = html;
  return lastSignatureElement(container)?.outerHTML ?? null;
}

/** Swap, add, or remove the signature block. An empty `block` removes it. */
export function withSignatureBlock(html: string, block: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const existing = lastSignatureElement(container);
  if (existing && block) {
    existing.outerHTML = block;
    return container.innerHTML;
  }
  existing?.remove();
  while (container.lastChild && (
    (container.lastChild instanceof HTMLBRElement) ||
    (container.lastChild.nodeType === Node.TEXT_NODE && !container.lastChild.textContent?.trim())
  )) container.lastChild.remove();
  return block ? `${container.innerHTML}<br><br>${block}` : container.innerHTML;
}
