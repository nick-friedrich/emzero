import { afterEach, describe, expect, it, vi } from 'vitest';
import { signatureBody, signatureForAccount, storedSignatures } from './signatures';

function stubStorage(value: string | null) {
  vi.stubGlobal('window', { localStorage: { getItem: vi.fn(() => value) } });
}

describe('mail signatures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the signature assigned to an account', () => {
    stubStorage(JSON.stringify([{ id: 'work', name: 'Work', body: 'Nick\nEmzero', accountIds: ['account-1', 'account-2'] }]));
    expect(signatureForAccount('account-2')).toBe('Nick\nEmzero');
    expect(signatureBody('account-1')).toBe('\n\n-- \nNick\nEmzero');
  });

  it('ignores malformed stored data', () => {
    stubStorage('{broken');
    expect(storedSignatures()).toEqual([]);
    expect(signatureForAccount('account-1')).toBe('');
  });
});
