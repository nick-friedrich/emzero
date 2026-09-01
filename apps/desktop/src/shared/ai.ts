import type { MailAddressSummary, MailComposerKind } from './accounts.js';
import { splitQuotedText } from './conversations.js';

export const DEFAULT_AI_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_AI_MODEL = 'openrouter/auto';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
export const MAX_AI_CONVERSATION_CONTEXT_LENGTH = 120_000;

export type AiProvider = 'openrouter' | 'openai' | 'custom';

export interface AiSettingsSummary {
  configured: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

export interface AiSettingsUpdate {
  apiKey: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

export interface AiModelSummary {
  id: string;
  name: string;
  description?: string;
}

export interface AiModelListRequest {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  query: string;
}

export interface AiModelListResult {
  ok: boolean;
  models: AiModelSummary[];
  message?: string;
}

export interface AiOperationResult {
  ok: boolean;
  message: string;
  settings?: AiSettingsSummary;
}

export interface AiDraftMessageRequest {
  kind: MailComposerKind;
  prompt: string;
  accountEmail: string;
  subject: string;
  to: MailAddressSummary[];
  cc: MailAddressSummary[];
  existingDraft: string;
  conversation: AiConversationMessage[];
}

export interface AiConversationMessage {
  sentAt: string | null;
  from: MailAddressSummary[];
  to: MailAddressSummary[];
  text: string;
}

export interface AiDraftMessageResult {
  ok: boolean;
  message?: string;
  text?: string;
}

function formatAddresses(addresses: MailAddressSummary[]): string {
  return addresses
    .map(({ name, address }) => name && address ? `${name} <${address}>` : address ?? name ?? '')
    .filter(Boolean)
    .join(', ');
}

export function formatAiConversationContext(
  conversation: AiConversationMessage[],
  maximumLength = MAX_AI_CONVERSATION_CONTEXT_LENGTH,
): string {
  const ordered = conversation
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTime = left.message.sentAt ? Date.parse(left.message.sentAt) : Number.NaN;
      const rightTime = right.message.sentAt ? Date.parse(right.message.sentAt) : Number.NaN;
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || leftTime === rightTime) {
        return left.index - right.index;
      }
      return leftTime - rightTime;
    })
    .map(({ message }, index) => {
      const newText = splitQuotedText(message.text).visible || message.text.trim();
      return [
        `--- Message ${index + 1} ---`,
        `Date: ${message.sentAt || 'Unknown'}`,
        `From: ${formatAddresses(message.from) || 'Unknown'}`,
        `To: ${formatAddresses(message.to) || 'Unknown'}`,
        'Body:',
        newText || '(empty message)',
      ].join('\n');
    });

  const selected: string[] = [];
  let remaining = Math.max(1, maximumLength);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const separatorLength = selected.length > 0 ? 2 : 0;
    const block = ordered[index];
    if (block.length + separatorLength <= remaining) {
      selected.unshift(block);
      remaining -= block.length + separatorLength;
      continue;
    }
    if (selected.length === 0) selected.unshift(block.slice(0, remaining));
    break;
  }
  const omitted = selected.length < ordered.length;
  return `${omitted ? '[Earlier conversation content omitted because the thread is too long.]\n\n' : ''}${selected.join('\n\n')}`;
}

export const AI_CHANNELS = {
  getSettings: 'ai:get-settings',
  saveSettings: 'ai:save-settings',
  removeSettings: 'ai:remove-settings',
  listModels: 'ai:list-models',
  draftMessage: 'ai:draft-message',
} as const;

export function isAiProvider(value: unknown): value is AiProvider {
  return value === 'openrouter' || value === 'openai' || value === 'custom';
}

export function validateAiSettingsUpdate(value: AiSettingsUpdate): string | null {
  if (!isAiProvider(value.provider)) return 'Choose an AI provider.';
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

export function validAiModelListRequest(value: unknown): value is AiModelListRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<AiModelListRequest>;
  return (
    isAiProvider(request.provider) &&
    request.provider !== 'custom' &&
    typeof request.baseUrl === 'string' &&
    request.baseUrl.length <= 2_048 &&
    typeof request.apiKey === 'string' &&
    request.apiKey.length <= 4_096 &&
    typeof request.query === 'string' &&
    request.query.length <= 200
  );
}

export function validAiDraftMessageRequest(value: unknown): value is AiDraftMessageRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<AiDraftMessageRequest>;
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
  const validConversationMessage = (message: unknown) => {
    if (!message || typeof message !== 'object') return false;
    const candidate = message as Partial<AiConversationMessage>;
    return (
      (candidate.sentAt === null || typeof candidate.sentAt === 'string') &&
      validAddresses(candidate.from) &&
      validAddresses(candidate.to) &&
      typeof candidate.text === 'string' &&
      candidate.text.length <= 200_000
    );
  };
  return (
    (request.kind === 'new' || request.kind === 'reply' || request.kind === 'draft') &&
    typeof request.prompt === 'string' &&
    request.prompt.trim().length > 0 &&
    request.prompt.length <= 4_000 &&
    typeof request.accountEmail === 'string' &&
    request.accountEmail.length <= 320 &&
    typeof request.subject === 'string' &&
    request.subject.length <= 2_000 &&
    validAddresses(request.to) &&
    validAddresses(request.cc) &&
    typeof request.existingDraft === 'string' &&
    request.existingDraft.length <= 200_000 &&
    Array.isArray(request.conversation) &&
    request.conversation.length <= 100 &&
    request.conversation.every(validConversationMessage) &&
    request.conversation.reduce((total, message) => total + message.text.length, 0) <= 1_000_000
  );
}
