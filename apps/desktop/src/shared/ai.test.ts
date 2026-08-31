import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  validAiDraftReplyRequest,
  validateAiSettingsUpdate,
} from './ai.js';

describe('AI settings validation', () => {
  it('accepts the OpenRouter defaults', () => {
    expect(validateAiSettingsUpdate({
      apiKey: 'sk-or-example',
      baseUrl: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
    })).toBeNull();
  });

  it('accepts a local OpenAI-compatible endpoint', () => {
    expect(validateAiSettingsUpdate({
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'local-model',
    })).toBeNull();
  });

  it('rejects embedded credentials and non-http URLs', () => {
    expect(validateAiSettingsUpdate({
      apiKey: '',
      baseUrl: 'https://user:secret@example.com/v1',
      model: 'model',
    })).toContain('without credentials');
    expect(validateAiSettingsUpdate({
      apiKey: '',
      baseUrl: 'file:///tmp/api',
      model: 'model',
    })).toContain('HTTP or HTTPS');
    expect(validateAiSettingsUpdate({
      apiKey: 'secret',
      baseUrl: 'http://example.com/v1',
      model: 'model',
    })).toContain('Use HTTPS');
  });
});

describe('AI draft validation', () => {
  it('requires a bounded, non-empty prompt', () => {
    const request = {
      prompt: 'Reply warmly and accept.',
      accountEmail: 'me@example.com',
      subject: 'Dinner',
      from: [{ name: 'Ada', address: 'ada@example.com' }],
      to: [{ name: null, address: 'me@example.com' }],
      messageText: 'Would you like to join us?',
    };
    expect(validAiDraftReplyRequest(request)).toBe(true);
    expect(validAiDraftReplyRequest({ ...request, prompt: '  ' })).toBe(false);
  });
});
