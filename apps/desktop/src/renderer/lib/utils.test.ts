import { describe, expect, it } from 'vitest';
import { cn, keysInRange } from './utils';

describe('cn', () => {
  it('merges conditional and conflicting utility classes', () => {
    expect(cn('px-2', null, 'px-4')).toBe('px-4');
  });
});

describe('keysInRange', () => {
  it('selects an inclusive range in either direction', () => {
    const keys = ['a', 'b', 'c', 'd'];
    expect([...keysInRange(keys, 1, 3)]).toEqual(['b', 'c', 'd']);
    expect([...keysInRange(keys, 3, 1)]).toEqual(['b', 'c', 'd']);
  });

  it('contracts to the anchor when both indices match', () => {
    expect([...keysInRange(['a', 'b', 'c'], 1, 1)]).toEqual(['b']);
  });
});
