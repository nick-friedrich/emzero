import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  formatAiConversationContext,
  validAiDraftMessageRequest,
  validateAiSettingsUpdate,
} from './ai.js';

describe('AI settings validation', () => {
  it('accepts the OpenRouter defaults', () => {
    expect(validateAiSettingsUpdate({
      apiKey: 'sk-or-example',
      provider: 'openrouter',
      baseUrl: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
    })).toBeNull();
  });

  it('accepts a local OpenAI-compatible endpoint', () => {
    expect(validateAiSettingsUpdate({
      apiKey: '',
      provider: 'custom',
      baseUrl: 'http://localhost:11434/v1',
      model: 'local-model',
    })).toBeNull();
  });

  it('rejects embedded credentials and non-http URLs', () => {
    expect(validateAiSettingsUpdate({
      apiKey: '',
      provider: 'custom',
      baseUrl: 'https://user:secret@example.com/v1',
      model: 'model',
    })).toContain('without credentials');
    expect(validateAiSettingsUpdate({
      apiKey: '',
      provider: 'custom',
      baseUrl: 'file:///tmp/api',
      model: 'model',
    })).toContain('HTTP or HTTPS');
    expect(validateAiSettingsUpdate({
      apiKey: 'secret',
      provider: 'custom',
      baseUrl: 'http://example.com/v1',
      model: 'model',
    })).toContain('Use HTTPS');
  });
});

describe('AI draft validation', () => {
  it('requires a bounded, non-empty prompt', () => {
    const request = {
      kind: 'reply' as const,
      prompt: 'Reply warmly and accept.',
      accountEmail: 'me@example.com',
      subject: 'Dinner',
      to: [{ name: 'Ada', address: 'ada@example.com' }],
      cc: [],
      existingDraft: '',
      conversation: [{
        sentAt: '2026-08-31T12:00:00.000Z',
        from: [{ name: 'Ada', address: 'ada@example.com' }],
        to: [{ name: null, address: 'me@example.com' }],
        text: 'Would you like to join us?',
      }],
    };
    expect(validAiDraftMessageRequest(request)).toBe(true);
    expect(validAiDraftMessageRequest({ ...request, prompt: '  ' })).toBe(false);
  });

  it('allows new-message drafting without a conversation', () => {
    expect(validAiDraftMessageRequest({
      kind: 'new',
      prompt: 'Ask for a project update.',
      accountEmail: 'me@example.com',
      subject: 'Project update',
      to: [{ name: 'Ada', address: 'ada@example.com' }],
      cc: [],
      existingDraft: '',
      conversation: [],
    })).toBe(true);
  });

  it('formats the full thread chronologically without duplicated quoted replies', () => {
    const context = formatAiConversationContext([
      {
        sentAt: '2026-08-31T14:00:00.000Z',
        from: [{ name: 'Me', address: 'me@example.com' }],
        to: [{ name: 'Ada', address: 'ada@example.com' }],
        text: 'Yes, that sounds good.\n\nOn Sun, Ada wrote:\nWould you like to join us?',
      },
      {
        sentAt: '2026-08-31T12:00:00.000Z',
        from: [{ name: 'Ada', address: 'ada@example.com' }],
        to: [{ name: 'Me', address: 'me@example.com' }],
        text: 'Would you like to join us?',
      },
    ]);

    expect(context.indexOf('Would you like to join us?')).toBeLessThan(
      context.indexOf('Yes, that sounds good.'),
    );
    expect(context.match(/Would you like to join us\?/g)).toHaveLength(1);
    expect(context).toContain('From: Ada <ada@example.com>');
  });

  it('keeps the newest context when a thread exceeds the size limit', () => {
    const context = formatAiConversationContext([
      {
        sentAt: '2026-08-31T12:00:00.000Z',
        from: [],
        to: [],
        text: 'old context that should be omitted',
      },
      {
        sentAt: '2026-08-31T13:00:00.000Z',
        from: [],
        to: [],
        text: 'newest context',
      },
    ], 100);

    expect(context).toContain('newest context');
    expect(context).not.toContain('old context that should be omitted');
    expect(context).toContain('Earlier conversation content omitted');
  });
});
