import { describe, expect, it } from 'vitest';
import { mailDateString, referenceIds } from './message-reader.js';

describe('message reader helpers', () => {
  it('normalizes valid dates and rejects invalid dates', () => {
    expect(mailDateString('2026-08-25T08:30:00Z')).toBe('2026-08-25T08:30:00.000Z');
    expect(mailDateString('not-a-date')).toBeNull();
    expect(mailDateString(undefined)).toBeNull();
  });

  it('extracts message IDs from header and whitespace formats', () => {
    expect(referenceIds('<first@example.com> <second@example.com>')).toEqual([
      '<first@example.com>',
      '<second@example.com>',
    ]);
    expect(referenceIds(['first', 'second'])).toEqual(['first', 'second']);
  });
});
