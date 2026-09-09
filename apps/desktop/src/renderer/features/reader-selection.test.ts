import { describe, expect, it } from 'vitest';
import { readerSelectionAfterRemoval } from './reader-selection';

interface Row {
  id: string;
}

const keyOf = (row: Row) => row.id;
const first: Row = { id: 'first' };
const second: Row = { id: 'second' };
const third: Row = { id: 'third' };

describe('readerSelectionAfterRemoval', () => {
  it('leaves the reader closed when a row nobody opened is deleted', () => {
    expect(readerSelectionAfterRemoval({
      current: null,
      keyOf,
      removedKey: first.id,
      selectNext: true,
      next: second,
    })).toBeNull();
  });

  it('keeps the open conversation when another row is deleted', () => {
    expect(readerSelectionAfterRemoval({
      current: third,
      keyOf,
      removedKey: first.id,
      selectNext: true,
      next: second,
    })).toBe(third);
  });

  it('opens the next conversation when the open one is deleted', () => {
    expect(readerSelectionAfterRemoval({
      current: first,
      keyOf,
      removedKey: first.id,
      selectNext: true,
      next: second,
    })).toBe(second);
  });

  it('closes the reader when the open one is deleted and nothing follows it', () => {
    expect(readerSelectionAfterRemoval({
      current: first,
      keyOf,
      removedKey: first.id,
      selectNext: true,
      next: undefined,
    })).toBeNull();
  });

  it('closes the reader when the open one is deleted and continued reading is off', () => {
    expect(readerSelectionAfterRemoval({
      current: first,
      keyOf,
      removedKey: first.id,
      selectNext: false,
      next: second,
    })).toBeNull();
  });
});
