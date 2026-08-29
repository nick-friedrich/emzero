import type { ImapFlow } from 'imapflow';
import { describe, expect, it, vi } from 'vitest';
import { closeImap } from './mail-runtime.js';

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
