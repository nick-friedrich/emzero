import { describe, expect, it } from 'vitest';
import {
  messageInsightTags,
  sanitizedSmartInboxSettings,
  skipsUnifiedInbox,
  smartInboxContains,
  validateSmartInboxDraft,
  type MessageInsights,
  type SmartInbox,
} from './mail-insights.js';

const insights = (overrides: Partial<MessageInsights> = {}): MessageInsights => ({
  category: 'newsletter',
  categoryConfidence: 0.99,
  needsReply: 0.1,
  urgency: 0.1,
  urgencyConfidence: 0.9,
  ruleScores: {},
  ...overrides,
});

const newsletters: SmartInbox = {
  id: 'news',
  name: 'Newsletters',
  rule: 'Newsletters and marketing mail',
  skipInbox: true,
  excludedSenders: [],
  createdAt: '2026-09-18T00:00:00.000Z',
};

const from = (address: string) => [{ name: null, address }];

describe('messageInsightTags', () => {
  it('shows only confident tags, most actionable first', () => {
    expect(messageInsightTags(insights())).toEqual([{ kind: 'category', label: 'Newsletter' }]);
    expect(messageInsightTags(insights({
      category: 'personal',
      needsReply: 0.92,
      urgency: 1.8,
      urgencyConfidence: 0.8,
    })).map(({ kind }) => kind)).toEqual(['urgent', 'needs-reply', 'category']);
    expect(messageInsightTags(insights({ categoryConfidence: 0.4, urgency: 1.9, urgencyConfidence: 0.19 })))
      .toEqual([]);
    expect(messageInsightTags(undefined)).toEqual([]);
  });
});

describe('smart inbox membership', () => {
  it('matches confident rule scores unless the sender was excluded', () => {
    const matching = { from: from('News@Example.com'), insights: insights({ ruleScores: { news: 0.9 } }) };
    expect(smartInboxContains(newsletters, matching)).toBe(true);
    expect(smartInboxContains(newsletters, { ...matching, insights: insights({ ruleScores: { news: 0.5 } }) }))
      .toBe(false);
    expect(smartInboxContains({ ...newsletters, excludedSenders: ['news@example.com'] }, matching))
      .toBe(false);
    expect(smartInboxContains(newsletters, { from: matching.from })).toBe(false);
  });

  it('hides mail from the unified inbox only for skip-inbox matches', () => {
    const matching = { from: from('news@example.com'), insights: insights({ ruleScores: { news: 0.9 } }) };
    expect(skipsUnifiedInbox([newsletters], matching)).toBe(true);
    expect(skipsUnifiedInbox([{ ...newsletters, skipInbox: false }], matching)).toBe(false);
  });
});

describe('smart inbox settings', () => {
  it('validates drafts', () => {
    expect(validateSmartInboxDraft({ name: 'News', rule: 'Newsletters', skipInbox: true })).toBeNull();
    expect(validateSmartInboxDraft({ name: ' ', rule: 'Newsletters', skipInbox: true })).toBe('Enter a name.');
    expect(validateSmartInboxDraft({ name: 'News', rule: '', skipInbox: true }))
      .toBe('Describe which mail belongs in this inbox.');
  });

  it('drops malformed stored inboxes and normalizes senders', () => {
    expect(sanitizedSmartInboxSettings({
      enabled: true,
      inboxes: [
        { ...newsletters, excludedSenders: ['A@Example.com', 'a@example.com', 7] },
        { id: 'bad id!', name: 'x', rule: 'y', skipInbox: false },
        null,
      ],
    })).toEqual({
      enabled: true,
      inboxes: [{ ...newsletters, excludedSenders: ['a@example.com'] }],
    });
    expect(sanitizedSmartInboxSettings('nope')).toEqual({ enabled: false, inboxes: [] });
  });
});
