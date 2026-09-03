export interface MailSignature {
  id: string;
  name: string;
  body: string;
  accountIds: string[];
}

export const signaturesStorageKey = 'emzero-signatures';

export function storedSignatures(): MailSignature[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(signaturesStorageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is MailSignature => {
      if (!item || typeof item !== 'object') return false;
      const signature = item as Partial<MailSignature>;
      return typeof signature.id === 'string' && typeof signature.name === 'string' &&
        typeof signature.body === 'string' && Array.isArray(signature.accountIds) &&
        signature.accountIds.every((accountId) => typeof accountId === 'string');
    });
  } catch {
    return [];
  }
}

export function saveSignatures(signatures: MailSignature[]): void {
  window.localStorage.setItem(signaturesStorageKey, JSON.stringify(signatures));
}

export function signatureForAccount(accountId: string): string {
  return storedSignatures().find((signature) => signature.accountIds.includes(accountId))?.body.trim() ?? '';
}

export function signatureIdForAccount(accountId: string): string {
  return storedSignatures().find((signature) => signature.accountIds.includes(accountId))?.id ?? '';
}

export function signatureBodyForId(signatureId: string): string {
  return storedSignatures().find((signature) => signature.id === signatureId)?.body.trim() ?? '';
}

export function formatSignature(signature: string): string {
  return signature ? `\n\n${signature}` : '';
}

export function signatureBody(accountId: string): string {
  return formatSignature(signatureForAccount(accountId));
}

export function replaceSignature(message: string, previousSignatureId: string, nextSignatureId: string): string {
  const previousBody = signatureBodyForId(previousSignatureId);
  const previous = formatSignature(previousBody);
  const legacyPrevious = previousBody ? `\n\n-- \n${previousBody}` : '';
  const next = formatSignature(signatureBodyForId(nextSignatureId));
  if (previous && message.endsWith(previous)) return `${message.slice(0, -previous.length)}${next}`;
  if (legacyPrevious && message.endsWith(legacyPrevious)) {
    return `${message.slice(0, -legacyPrevious.length)}${next}`;
  }
  return `${message}${next}`;
}
