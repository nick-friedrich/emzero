import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadSignatures,
  replaceSignature,
  saveSignatures,
  signatureBody,
  signatureForAccount,
  signatureSuffix,
  storedSignatures,
  withoutSignature,
} from './signatures';

const work = { id: 'work', name: 'Work', body: 'Nick\nEmzero', accountIds: ['account-1', 'account-2'] };
const short = { id: 'short', name: 'Short', body: 'Nick', accountIds: [] };

function stubWindow(options: {
  stored?: unknown;
  initialized?: boolean;
  legacy?: string | null;
}) {
  const save = vi.fn(() => Promise.resolve(true));
  const list = vi.fn(() => Promise.resolve({
    signatures: options.stored ?? [],
    initialized: options.initialized ?? true,
  }));
  vi.stubGlobal('window', {
    emzero: { signatures: { list, save } },
    localStorage: { getItem: vi.fn(() => options.legacy ?? null) },
  });
  vi.stubGlobal('BroadcastChannel', class {
    onmessage: unknown = null;
    postMessage() { /* no cross-window listeners in tests */ }
    close() { /* no cross-window listeners in tests */ }
  });
  return { list, save };
}

describe('mail signatures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves signatures loaded from the main process', async () => {
    stubWindow({ stored: [work] });
    await loadSignatures();

    expect(signatureForAccount('account-2')).toBe('Nick\nEmzero');
    expect(signatureBody('account-1')).toBe('\n\n-- \nNick\nEmzero');
  });

  it('migrates a legacy browser-storage copy once, without clearing it', async () => {
    const { save } = stubWindow({ initialized: false, legacy: JSON.stringify([work]) });
    await loadSignatures();

    expect(save).toHaveBeenCalledWith([work]);
    expect(storedSignatures()).toEqual([work]);
  });

  it('keeps stored signatures instead of resurrecting a legacy copy', async () => {
    const { save } = stubWindow({ stored: [], initialized: true, legacy: JSON.stringify([work]) });
    await loadSignatures();

    expect(save).not.toHaveBeenCalled();
    expect(storedSignatures()).toEqual([]);
  });

  it('falls back to the legacy copy when main-process storage fails', async () => {
    stubWindow({ legacy: JSON.stringify([work]) });
    window.emzero.signatures.list = vi.fn(() => Promise.reject(new Error('unavailable')));
    await loadSignatures();

    expect(storedSignatures()).toEqual([work]);
  });

  it('ignores malformed stored and legacy data', async () => {
    stubWindow({ initialized: false, legacy: '{broken' });
    await loadSignatures();

    expect(storedSignatures()).toEqual([]);
    expect(signatureForAccount('account-1')).toBe('');
  });

  it('appends the standard delimiter and still recognizes signatures written without it', async () => {
    stubWindow({ stored: [work, short] });
    await loadSignatures();

    expect(replaceSignature('Hello\n\n-- \nNick\nEmzero', 'work', 'short')).toBe('Hello\n\n-- \nNick');
    expect(replaceSignature('Hello\n\nNick\nEmzero', 'work', 'short')).toBe('Hello\n\n-- \nNick');
    expect(replaceSignature('Hello', '', 'short')).toBe('Hello\n\n-- \nNick');
    expect(signatureSuffix('Hello\n\n-- \nNick', 'short')).toBe('\n\n-- \nNick');
    expect(signatureSuffix('Hello', 'short')).toBe('');
    expect(withoutSignature('Hello\n\nNick', 'short')).toBe('Hello');
  });

  it('persists edits through the main process', async () => {
    const { save } = stubWindow({ stored: [work] });
    await loadSignatures();
    saveSignatures([short]);

    expect(save).toHaveBeenCalledWith([short]);
    expect(storedSignatures()).toEqual([short]);
  });
});
