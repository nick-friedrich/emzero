import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  dialog: {},
  safeStorage: {},
}));

import { decryptBackup, encryptBackup, validAppSettingsBackup } from './account-backup.js';

const settings = {
  theme: 'dark',
  interfaceFont: 'inter',
  alwaysLoadRemoteImages: false,
  markReadOnOpen: true,
  selectNextOnDelete: true,
  signatures: [{
    id: 'signature-1',
    name: 'Work',
    body: 'Nick\nEmzero',
    accountIds: ['account-1', 'account-2'],
  }],
};

describe('account backup app settings', () => {
  it('round-trips optional settings and signatures through encryption', async () => {
    const encrypted = await encryptBackup({
      exportedAt: '2026-08-30T00:00:00.000Z',
      accounts: [],
      appSettings: settings,
    }, 'correct horse battery staple');

    await expect(decryptBackup(encrypted, 'correct horse battery staple')).resolves.toEqual({
      exportedAt: '2026-08-30T00:00:00.000Z',
      accounts: [],
      appSettings: settings,
    });
  });

  it('accepts older account-only payloads and rejects malformed settings', async () => {
    const legacyPayload = { exportedAt: '2026-08-29T00:00:00.000Z', accounts: [] };
    const encrypted = await encryptBackup(legacyPayload, 'correct horse battery staple');
    await expect(decryptBackup(encrypted, 'correct horse battery staple')).resolves.toEqual(legacyPayload);
    expect(validAppSettingsBackup(settings)).toBe(true);
    expect(validAppSettingsBackup({ ...settings, theme: 'unknown-theme' })).toBe(false);
    expect(validAppSettingsBackup({ ...settings, signatures: [{ body: 42 }] })).toBe(false);
  });
});
