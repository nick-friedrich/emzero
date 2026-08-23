import { describe, expect, it } from 'vitest';
import { type AccountDraft, validateAccountDraft } from './accounts.js';

const validDraft: AccountDraft = {
  name: 'Personal',
  email: 'hello@example.com',
  username: 'hello@example.com',
  password: 'secret',
  imap: { host: 'imap.example.com', port: 993, secure: true },
  smtp: { host: 'smtp.example.com', port: 465, secure: true },
};

describe('validateAccountDraft', () => {
  it('accepts a complete account', () => {
    expect(validateAccountDraft(validDraft)).toBeNull();
  });

  it('rejects invalid addresses and ports', () => {
    expect(validateAccountDraft({ ...validDraft, email: 'invalid' })).toMatch(/valid email/);
    expect(
      validateAccountDraft({ ...validDraft, imap: { ...validDraft.imap, port: 70_000 } }),
    ).toMatch(/valid IMAP port/);
  });
});
