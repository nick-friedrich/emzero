import { resolveMx } from 'node:dns/promises';
import providerCatalog from '../providers/catalog.json' with { type: 'json' };
import type { MailProvider, ProviderDiscoveryResult } from '../shared/accounts.js';

const providers = providerCatalog as MailProvider[];

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function findProvider(domain: string, mxHosts: string[] = []): ProviderDiscoveryResult {
  const normalizedDomain = normalizeHostname(domain);
  const domainMatch = providers.find((provider) =>
    provider.domains.some((candidate) => normalizeHostname(candidate) === normalizedDomain),
  );
  if (domainMatch) return { provider: domainMatch, detectedBy: 'domain' };

  const normalizedMxHosts = mxHosts.map(normalizeHostname);
  const mxMatch = providers.find((provider) =>
    provider.mxPatterns.some((pattern) => {
      const normalizedPattern = normalizeHostname(pattern);
      return normalizedMxHosts.some(
        (host) => host === normalizedPattern || host.endsWith(`.${normalizedPattern}`),
      );
    }),
  );
  return mxMatch
    ? { provider: mxMatch, detectedBy: 'mx' }
    : { provider: null, detectedBy: null };
}

export function listProviders(): MailProvider[] {
  return providers;
}

export async function discoverProvider(email: string): Promise<ProviderDiscoveryResult> {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain || !domain.includes('.') || /[^a-z0-9.-]/.test(domain)) {
    return { provider: null, detectedBy: null };
  }

  const knownProvider = findProvider(domain);
  if (knownProvider.provider) return knownProvider;

  try {
    const records = await resolveMx(domain);
    return findProvider(
      domain,
      records.map((record) => record.exchange),
    );
  } catch {
    return { provider: null, detectedBy: null };
  }
}

