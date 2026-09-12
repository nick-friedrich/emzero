export interface MailSignature {
  id: string;
  name: string;
  body: string;
  accountIds: string[];
}

export interface SignatureListResult {
  signatures: MailSignature[];
  /**
   * False only while no signature file has been written yet, which is what lets the renderer
   * migrate a legacy browser-storage copy exactly once instead of resurrecting deleted entries.
   */
  initialized: boolean;
}

export const SIGNATURE_CHANNELS = {
  list: 'signatures:list',
  save: 'signatures:save',
} as const;

export const SIGNATURE_LIMITS = {
  count: 100,
  id: 200,
  name: 1_000,
  body: 100_000,
  accountIds: 1_000,
} as const;

export function validMailSignature(value: unknown): value is MailSignature {
  if (!value || typeof value !== 'object') return false;
  const signature = value as Partial<MailSignature>;
  return (
    typeof signature.id === 'string' &&
    signature.id.length <= SIGNATURE_LIMITS.id &&
    typeof signature.name === 'string' &&
    signature.name.length <= SIGNATURE_LIMITS.name &&
    typeof signature.body === 'string' &&
    signature.body.length <= SIGNATURE_LIMITS.body &&
    Array.isArray(signature.accountIds) &&
    signature.accountIds.length <= SIGNATURE_LIMITS.accountIds &&
    signature.accountIds.every(
      (accountId) => typeof accountId === 'string' && accountId.length <= SIGNATURE_LIMITS.id,
    )
  );
}

export function validMailSignatures(value: unknown): value is MailSignature[] {
  return (
    Array.isArray(value) &&
    value.length <= SIGNATURE_LIMITS.count &&
    value.every((entry) => validMailSignature(entry))
  );
}

/**
 * Signatures never carry credentials. Rebuilding each entry field by field keeps anything else a
 * renderer sent — a stray token, an oversized blob — out of the settings file and out of backups.
 */
export function toStoredSignature(signature: MailSignature): MailSignature {
  return {
    id: signature.id,
    name: signature.name,
    body: signature.body,
    accountIds: [...signature.accountIds],
  };
}
