import { describe, expect, it } from 'vitest';
import {
  EMZERO_IMPORTANT_KEYWORD,
  emzeroColorFromFlags,
  emzeroColorKeyword,
  emzeroDueKeyword,
  emzeroImportanceFromFlags,
  supportsEmzeroKeywords,
  tomorrowDateKey,
  validDateKey,
} from './message-keywords.js';

describe('Emzero message keywords', () => {
  it('encodes and parses an important message with a due date', () => {
    const flags = new Set([EMZERO_IMPORTANT_KEYWORD.toLowerCase(), emzeroDueKeyword('2026-09-04')]);
    expect(emzeroImportanceFromFlags(flags)).toEqual({ important: true, dueDate: '2026-09-04' });
  });

  it('does not expose an orphaned due date as important', () => {
    expect(emzeroImportanceFromFlags(new Set([emzeroDueKeyword('2026-09-04')]))).toEqual({
      important: false,
      dueDate: null,
    });
  });

  it('validates real calendar dates and calculates tomorrow in local time', () => {
    expect(validDateKey('2024-02-29')).toBe(true);
    expect(validDateKey('2026-02-29')).toBe(false);
    expect(tomorrowDateKey(new Date(2026, 11, 31, 23, 30))).toBe('2027-01-01');
  });

  it('requires arbitrary permanent keyword support', () => {
    expect(supportsEmzeroKeywords(undefined)).toBe(true);
    expect(supportsEmzeroKeywords(new Set(['\\Seen', '\\*']))).toBe(true);
    expect(supportsEmzeroKeywords(new Set(['\\Seen', EMZERO_IMPORTANT_KEYWORD]))).toBe(false);
  });

  it('encodes and parses the fixed message color palette', () => {
    expect(emzeroColorKeyword('purple')).toBe('Emzero-Color-purple-v1');
    expect(emzeroColorFromFlags(new Set(['emzero-color-BLUE-v1']))).toBe('blue');
    expect(emzeroColorFromFlags(new Set(['\\Seen']))).toBeNull();
  });
});
