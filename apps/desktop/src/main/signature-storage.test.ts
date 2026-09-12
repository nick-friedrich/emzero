import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userData = { path: '' };

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userData.path) },
}));

import { readSignatures, writeSignatures } from './signature-storage.js';

const work = { id: 'work', name: 'Work', body: 'Nick\nEmzero', accountIds: ['account-1'] };

beforeEach(async () => {
  userData.path = await mkdtemp(path.join(tmpdir(), 'emzero-signatures-'));
});

describe('signature storage', () => {
  it('reports an unwritten file so the renderer can migrate once', async () => {
    await expect(readSignatures()).resolves.toEqual({ signatures: [], initialized: false });
  });

  it('round-trips signatures through a private file', async () => {
    await writeSignatures([work]);

    await expect(readSignatures()).resolves.toEqual({ signatures: [work], initialized: true });
    const { mode } = await import('node:fs/promises').then(({ stat }) =>
      stat(path.join(userData.path, 'signatures.json')));
    expect(mode & 0o077).toBe(0);
  });

  it('stores only signature fields, never anything else the renderer sent', async () => {
    await writeSignatures([
      { ...work, password: 'hunter2', accessToken: 'secret' } as never,
    ]);

    const contents = await readFile(path.join(userData.path, 'signatures.json'), 'utf8');
    expect(contents).not.toContain('hunter2');
    expect(contents).not.toContain('secret');
    expect(JSON.parse(contents)).toEqual([work]);
  });

  it('treats a damaged file as written, so a stale copy cannot overwrite it', async () => {
    await writeFile(path.join(userData.path, 'signatures.json'), '{broken');

    await expect(readSignatures()).resolves.toEqual({ signatures: [], initialized: true });
  });

  it('rejects data that does not match the signature shape', async () => {
    await writeFile(path.join(userData.path, 'signatures.json'), JSON.stringify([{ id: 5 }]));

    await expect(readSignatures()).resolves.toEqual({ signatures: [], initialized: true });
  });
});
