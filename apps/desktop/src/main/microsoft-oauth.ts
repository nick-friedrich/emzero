import { randomUUID } from 'node:crypto';
import type { MicrosoftAuthStartResult } from '../shared/accounts.js';

const tenant = 'common';
const oauthBase = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
const scopes = [
  'offline_access',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
  message?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface OAuthErrorResponse {
  error?: string;
  error_description?: string;
}

interface DeviceSession {
  clientId: string;
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
  cancelled: boolean;
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sessions = new Map<string, DeviceSession>();

async function formRequest<T>(url: string, values: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  const value = await response.json() as T & OAuthErrorResponse;
  if (!response.ok) {
    throw new Error(value.error_description || value.error || 'Microsoft sign-in failed.');
  }
  return value;
}

export async function beginMicrosoftAuth(clientId: string): Promise<MicrosoftAuthStartResult> {
  const normalizedClientId = clientId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedClientId)) {
    return { ok: false, message: 'Enter a valid Microsoft Application (client) ID.' };
  }
  try {
    const result = await formRequest<DeviceCodeResponse>(`${oauthBase}/devicecode`, {
      client_id: normalizedClientId,
      scope: scopes,
    });
    const sessionId = randomUUID();
    const expiresAt = Date.now() + result.expires_in * 1_000;
    sessions.set(sessionId, {
      clientId: normalizedClientId,
      deviceCode: result.device_code,
      expiresAt,
      intervalMs: Math.max(result.interval ?? 5, 1) * 1_000,
      cancelled: false,
    });
    return {
      ok: true,
      sessionId,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      expiresAt: new Date(expiresAt).toISOString(),
      message:
        result.message ??
        `Open ${result.verification_uri} and enter code ${result.user_code}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Microsoft sign-in could not start.',
    };
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function finishMicrosoftAuth(sessionId: string): Promise<MicrosoftTokens> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('This Microsoft sign-in session is no longer available.');

  try {
    while (Date.now() < session.expiresAt) {
      await wait(session.intervalMs);
      if (session.cancelled) throw new Error('Microsoft sign-in was cancelled.');
      const response = await fetch(`${oauthBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: session.clientId,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: session.deviceCode,
        }),
      });
      const value = await response.json() as Partial<TokenResponse> & OAuthErrorResponse;
      if (response.ok && value.access_token && value.refresh_token && value.expires_in) {
        return {
          accessToken: value.access_token,
          refreshToken: value.refresh_token,
          expiresIn: value.expires_in,
        };
      }
      if (value.error === 'authorization_pending') continue;
      if (value.error === 'slow_down') {
        session.intervalMs += 5_000;
        continue;
      }
      if (value.error === 'authorization_declined') {
        throw new Error('Microsoft sign-in was declined.');
      }
      if (value.error === 'expired_token') break;
      throw new Error(value.error_description || value.error || 'Microsoft sign-in failed.');
    }
    throw new Error('Microsoft sign-in expired. Start again to receive a new code.');
  } finally {
    sessions.delete(sessionId);
  }
}

export function cancelMicrosoftAuth(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.cancelled = true;
  return true;
}

export async function refreshMicrosoftAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<MicrosoftTokens> {
  const result = await formRequest<TokenResponse>(`${oauthBase}/token`, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: scopes,
  });
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? refreshToken,
    expiresIn: result.expires_in,
  };
}
