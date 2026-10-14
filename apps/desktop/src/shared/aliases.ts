import type { AccountSummary, MailAddressSummary } from './accounts.js';

/**
 * An extra address an account can send as, such as a custom-domain address hosted on the
 * same mailbox. An empty name sends with the account's own display name.
 */
export interface MailAlias {
  address: string;
  name: string;
}

export const MAX_ACCOUNT_ALIASES = 50;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/** Every address that belongs to the account: its email, its username, and its aliases. */
export function accountAddresses(
  account: Pick<AccountSummary, 'email' | 'username' | 'aliases'>,
): Set<string> {
  return new Set(
    [account.email, account.username, ...account.aliases.map(({ address }) => address)]
      .map(normalized)
      .filter(Boolean),
  );
}

/**
 * The From address for a message sent as `from`, or the account's own address when `from` is
 * empty. Returns null when `from` is not the account's address or one of its aliases.
 */
export function sendingIdentity(
  account: Pick<AccountSummary, 'name' | 'email' | 'aliases'>,
  from?: string | null,
): { name: string; address: string } | null {
  const requested = normalized(from);
  if (!requested || requested === normalized(account.email)) {
    return { name: account.name, address: account.email };
  }
  const alias = account.aliases.find(({ address }) => normalized(address) === requested);
  return alias ? { name: alias.name.trim() || account.name, address: alias.address } : null;
}

/**
 * The first of the account's aliases among `addresses`, such as the alias a message was sent
 * to (so the reply comes from it) or a saved draft's From. Returns undefined when the account's
 * own address comes first, or no alias appears at all.
 */
export function matchingAlias(
  account: Pick<AccountSummary, 'email' | 'aliases'>,
  addresses: MailAddressSummary[],
): string | undefined {
  const primary = normalized(account.email);
  for (const candidate of addresses) {
    const address = normalized(candidate.address);
    if (!address) continue;
    if (address === primary) return undefined;
    const alias = account.aliases.find((entry) => normalized(entry.address) === address);
    if (alias) return alias.address;
  }
  return undefined;
}

/** Validates and normalizes an alias list; returns an error message for invalid input. */
export function validateAliases(
  value: unknown,
  primaryEmail: string,
): { aliases: MailAlias[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'Invalid alias list.' };
  if (value.length > MAX_ACCOUNT_ALIASES) {
    return { error: `Add no more than ${MAX_ACCOUNT_ALIASES} aliases.` };
  }
  const seen = new Set([normalized(primaryEmail)]);
  const aliases: MailAlias[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return { error: 'Invalid alias.' };
    const { address, name } = entry as { address?: unknown; name?: unknown };
    if (typeof address !== 'string' || (name !== undefined && typeof name !== 'string')) {
      return { error: 'Invalid alias.' };
    }
    const trimmed = address.trim();
    if (!emailPattern.test(trimmed) || /[\r\n<>,;"]/.test(trimmed)) {
      return { error: `${trimmed || 'An alias'} is not a valid email address.` };
    }
    const displayName = (name ?? '').trim();
    if (displayName.length > 200 || /[\r\n]/.test(displayName)) {
      return { error: `The name for ${trimmed} is invalid.` };
    }
    if (seen.has(trimmed.toLowerCase())) {
      return { error: `${trimmed} is already an address of this account.` };
    }
    seen.add(trimmed.toLowerCase());
    aliases.push({ address: trimmed, name: displayName });
  }
  return { aliases };
}

/** Reads stored aliases leniently, dropping malformed entries instead of failing. */
export function storedAliases(value: unknown, primaryEmail: string): MailAlias[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const result = validateAliases([entry], primaryEmail);
    return 'aliases' in result ? result.aliases : [];
  }).filter((alias, index, all) =>
    all.findIndex((other) => normalized(other.address) === normalized(alias.address)) === index,
  ).slice(0, MAX_ACCOUNT_ALIASES);
}
