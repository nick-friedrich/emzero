import {
  SIGNATURE_LIMITS,
  validMailSignature,
  type MailSignature,
} from '../../shared/signatures';

export type { MailSignature };

/** Where releases before main-process storage kept signatures, scoped to the window's origin. */
export const signaturesStorageKey = 'emzero-signatures';
const settingsEventsChannel = 'emzero-settings-events';
/** RFC 3676 delimiter, so other mail clients can detect and collapse the signature. */
export const signatureSeparator = '\n\n-- \n';

let signatures: MailSignature[] = [];
let watching = false;
const listeners = new Set<() => void>();

function publish(next: MailSignature[]): void {
  signatures = next;
  for (const listener of listeners) listener();
}

export function storedSignatures(): MailSignature[] {
  return signatures;
}

export function subscribeSignatures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function legacySignatures(): MailSignature[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(signaturesStorageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is MailSignature => validMailSignature(entry))
      .slice(0, SIGNATURE_LIMITS.count);
  } catch {
    return [];
  }
}

function notifySignaturesChanged(): void {
  const channel = new BroadcastChannel(settingsEventsChannel);
  channel.postMessage({ type: 'signatures-changed' });
  channel.close();
}

function watchSignatureChanges(): void {
  if (watching) return;
  watching = true;
  const channel = new BroadcastChannel(settingsEventsChannel);
  channel.onmessage = (event: MessageEvent<{ type?: string } | null>) => {
    if (event.data?.type !== 'signatures-changed') return;
    void window.emzero.signatures
      .list()
      .then((result) => publish(result.signatures))
      .catch(() => {
        // Keep serving the cached signatures when the refresh fails.
      });
  };
}

/**
 * Hydrates the cache before the first render so every composer can read signatures synchronously.
 *
 * Signatures used to live in browser storage, which is scoped to the window origin: the packaged
 * app (`file://`) and a development server never saw each other's copies. The one-time migration
 * below moves an existing copy into the main process, and deliberately leaves the original in
 * place so a failed or partial run can be repeated.
 */
export async function loadSignatures(): Promise<void> {
  watchSignatureChanges();
  try {
    const result = await window.emzero.signatures.list();
    if (result.initialized) {
      publish(result.signatures);
      return;
    }
    const legacy = legacySignatures();
    publish(legacy.length > 0 ? legacy : result.signatures);
    if (legacy.length > 0) await window.emzero.signatures.save(legacy);
  } catch {
    // Main-process storage is unavailable. Serve the legacy copy for this session and leave it
    // untouched, so a later launch can still migrate it.
    publish(legacySignatures());
  }
}

export function saveSignatures(next: MailSignature[]): void {
  publish(next);
  void window.emzero.signatures
    .save(next)
    .then(() => notifySignaturesChanged())
    .catch(() => {
      // The in-memory cache still reflects the edit for this session.
    });
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
  return signature ? `${signatureSeparator}${signature}` : '';
}

export function signatureBody(accountId: string): string {
  return formatSignature(signatureForAccount(accountId));
}

function signatureVariants(signatureId: string): string[] {
  const body = signatureBodyForId(signatureId);
  if (!body) return [];
  // Releases between the delimiter's removal and its return appended signatures without it.
  return [`${signatureSeparator}${body}`, `\n\n${body}`];
}

/** The trailing signature a message currently carries, in either format, or an empty string. */
export function signatureSuffix(message: string, signatureId: string): string {
  return signatureVariants(signatureId).find((variant) => message.endsWith(variant)) ?? '';
}

export function withoutSignature(message: string, signatureId: string): string {
  const suffix = signatureSuffix(message, signatureId);
  return suffix ? message.slice(0, -suffix.length) : message;
}

export function replaceSignature(
  message: string,
  previousSignatureId: string,
  nextSignatureId: string,
): string {
  const next = formatSignature(signatureBodyForId(nextSignatureId));
  return `${withoutSignature(message, previousSignatureId)}${next}`;
}
