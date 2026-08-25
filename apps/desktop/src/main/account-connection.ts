import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import {
  type AccountDraft,
  type AccountOperationResult,
  validateAccountDraft,
} from '../shared/accounts.js';
import { errorMessage } from './mail-runtime.js';

async function verifyConnectionsWithSecret(
  draft: AccountDraft,
  secret: string,
): Promise<AccountOperationResult> {
  const validationError = validateAccountDraft(draft);
  if (validationError) return { ok: false, message: validationError };

  const oauth = draft.credentials.type === 'microsoft-oauth';

  const imap = new ImapFlow({
    host: draft.imap.host.trim(),
    port: draft.imap.port,
    secure: draft.imap.secure,
    auth: oauth
      ? { user: draft.username.trim(), accessToken: secret }
      : { user: draft.username.trim(), pass: secret },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 15_000,
  });

  const smtp = nodemailer.createTransport({
    host: draft.smtp.host.trim(),
    port: draft.smtp.port,
    secure: draft.smtp.secure,
    auth: oauth
      ? { type: 'OAuth2', user: draft.username.trim(), accessToken: secret }
      : { user: draft.username.trim(), pass: secret },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 15_000,
  });

  const [imapResult, smtpResult] = await Promise.allSettled([
    imap.connect().then(() => imap.logout()),
    smtp.verify(),
  ]);

  if (imapResult.status === 'rejected' || smtpResult.status === 'rejected') {
    if (imap.usable) await imap.logout().catch(() => undefined);
    smtp.close();
    const failures = [
      imapResult.status === 'rejected'
        ? `IMAP: ${errorMessage(imapResult.reason, secret)}`
        : null,
      smtpResult.status === 'rejected'
        ? `SMTP: ${errorMessage(smtpResult.reason, secret)}`
        : null,
    ].filter(Boolean);
    return { ok: false, message: failures.join(' · ') };
  }

  smtp.close();
  return { ok: true, message: 'IMAP and SMTP connections succeeded.' };
}

export async function verifyConnections(draft: AccountDraft): Promise<AccountOperationResult> {
  if (draft.credentials.type !== 'password') {
    return { ok: false, message: 'Use Microsoft sign-in to connect this account.' };
  }
  return verifyConnectionsWithSecret(draft, draft.credentials.password);
}

export function verifyMicrosoftConnections(
  draft: AccountDraft,
  accessToken: string,
): Promise<AccountOperationResult> {
  return verifyConnectionsWithSecret(draft, accessToken);
}
