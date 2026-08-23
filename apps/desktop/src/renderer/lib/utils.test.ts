import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conditional and conflicting utility classes', () => {
    expect(cn('px-2', null, 'px-4')).toBe('px-4');
  });
});
