import type { ImapFlow } from 'imapflow';
import { describe, expect, it, vi } from 'vitest';
import type { StoredAccount } from './account-storage.js';
import { closeImap, createImapClient } from './mail-runtime.js';

const account: StoredAccount = {
  id: 'account-1',
  name: 'Account',
  email: 'mail@example.com',
  username: 'mail@example.com',
  authentication: 'password',
  encryptedSecret: 'encrypted',
  createdAt: '2026-01-01T00:00:00.000Z',
  imap: { host: 'imap.example.com', port: 993, secure: true },
  smtp: { host: 'smtp.example.com', port: 465, secure: true },
};

function cleanupClient({
  usable,
  logout = vi.fn(async () => undefined),
  close = vi.fn(async () => undefined),
}: {
  usable: boolean;
  logout?: ReturnType<typeof vi.fn>;
  close?: ReturnType<typeof vi.fn>;
}): ImapFlow {
  return { usable, logout, close } as unknown as ImapFlow;
}

describe('closeImap', () => {
  it('logs out a usable connection', async () => {
    const imap = cleanupClient({ usable: true });

    await expect(closeImap(imap)).resolves.toBeUndefined();

    expect(imap.logout).toHaveBeenCalledOnce();
    expect(imap.close).not.toHaveBeenCalled();
  });

  it('falls back to close when logout fails', async () => {
    const imap = cleanupClient({
      usable: true,
      logout: vi.fn(async () => {
        throw new Error('Connection not available');
      }),
    });

    await expect(closeImap(imap)).resolves.toBeUndefined();

    expect(imap.close).toHaveBeenCalledOnce();
  });

  it('absorbs close failures from a connection lost during suspend', async () => {
    const imap = cleanupClient({
      usable: false,
      close: vi.fn(async () => {
        throw new Error('write EPIPE');
      }),
    });

    await expect(closeImap(imap)).resolves.toBeUndefined();

    expect(imap.close).toHaveBeenCalledOnce();
  });
});

describe('createImapClient', () => {
  it('absorbs supplemental socket error events instead of crashing the main process', () => {
    const imap = createImapClient(account, 'secret');

    expect(imap.listenerCount('error')).toBeGreaterThan(0);
    expect(() => imap.emit('error', new Error('write EPIPE'))).not.toThrow();

    imap.close();
  });
});
