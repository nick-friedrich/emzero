import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceSignature, signatureBody, signatureForAccount, storedSignatures } from './signatures';

function stubStorage(value: string | null) {
  vi.stubGlobal('window', { localStorage: { getItem: vi.fn(() => value) } });
}

describe('mail signatures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the signature assigned to an account', () => {
    stubStorage(JSON.stringify([{ id: 'work', name: 'Work', body: 'Nick\nEmzero', accountIds: ['account-1', 'account-2'] }]));
    expect(signatureForAccount('account-2')).toBe('Nick\nEmzero');
    expect(signatureBody('account-1')).toBe('\n\nNick\nEmzero');
  });

  it('replaces signatures without adding a separator and upgrades legacy signatures', () => {
    stubStorage(JSON.stringify([
      { id: 'work', name: 'Work', body: 'Nick\nEmzero', accountIds: ['account-1'] },
      { id: 'short', name: 'Short', body: 'Nick', accountIds: [] },
    ]));
    expect(replaceSignature('Hello\n\nNick\nEmzero', 'work', 'short')).toBe('Hello\n\nNick');
    expect(replaceSignature('Hello\n\n-- \nNick\nEmzero', 'work', 'short')).toBe('Hello\n\nNick');
  });

  it('ignores malformed stored data', () => {
    stubStorage('{broken');
    expect(storedSignatures()).toEqual([]);
    expect(signatureForAccount('account-1')).toBe('');
  });
});
