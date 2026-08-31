import type { MailAddressSummary } from './accounts.js';

export const DEFAULT_AI_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_AI_MODEL = 'openrouter/auto';

export interface AiSettingsSummary {
  configured: boolean;
  baseUrl: string;
  model: string;
}

export interface AiSettingsUpdate {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AiOperationResult {
  ok: boolean;
  message: string;
  settings?: AiSettingsSummary;
}

export interface AiDraftReplyRequest {
  prompt: string;
  accountEmail: string;
  subject: string;
  from: MailAddressSummary[];
  to: MailAddressSummary[];
  messageText: string;
}

export interface AiDraftReplyResult {
  ok: boolean;
  message?: string;
  text?: string;
}

export const AI_CHANNELS = {
  getSettings: 'ai:get-settings',
  saveSettings: 'ai:save-settings',
  removeSettings: 'ai:remove-settings',
  draftReply: 'ai:draft-reply',
} as const;

export function validateAiSettingsUpdate(value: AiSettingsUpdate): string | null {
  if (value.baseUrl.length > 2_048) return 'The API base URL is too long.';
  try {
    const url = new URL(value.baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return 'The API base URL must use HTTP or HTTPS.';
    }
    if (
      url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      return 'Use HTTPS for remote AI providers. HTTP is allowed only for local endpoints.';
    }
    if (url.username || url.password || url.search || url.hash) {
      return 'Enter an API base URL without credentials, query parameters, or a fragment.';
    }
  } catch {
    return 'Enter a valid API base URL.';
  }
  if (!value.model.trim()) return 'Enter a model name.';
  if (value.model.length > 200) return 'The model name is too long.';
  if (value.apiKey.length > 4_096) return 'The API key is too long.';
  return null;
}

export function validAiDraftReplyRequest(value: unknown): value is AiDraftReplyRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<AiDraftReplyRequest>;
  const validAddresses = (addresses: unknown) =>
    Array.isArray(addresses) &&
    addresses.length <= 100 &&
    addresses.every(
      (address) =>
        address !== null &&
        typeof address === 'object' &&
        ((address as { name?: unknown }).name === null ||
          typeof (address as { name?: unknown }).name === 'string') &&
        ((address as { address?: unknown }).address === null ||
          typeof (address as { address?: unknown }).address === 'string'),
    );
  return (
    typeof request.prompt === 'string' &&
    request.prompt.trim().length > 0 &&
    request.prompt.length <= 4_000 &&
    typeof request.accountEmail === 'string' &&
    request.accountEmail.length <= 320 &&
    typeof request.subject === 'string' &&
    request.subject.length <= 2_000 &&
    validAddresses(request.from) &&
    validAddresses(request.to) &&
    typeof request.messageText === 'string' &&
    request.messageText.length <= 200_000
  );
}
