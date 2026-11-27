import { describe, expect, it } from 'vitest';
import { readerSelectionAfterRemoval, withReadingOrder } from './reader-selection';

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

describe('withReadingOrder', () => {
  interface Timed {
    id: string;
    time: number;
  }
  const order = (captured: Timed[], current: Timed[], visible = current) =>
    withReadingOrder({
      captured: new Map(captured.map((item) => [item.id, item.time])),
      current,
      visible,
      keyOf: (item) => item.id,
      timeOf: (item) => item.time,
    }).map((item) => item.id);

  it('merges a newly arrived conversation by date instead of appending it', () => {
    const older = { id: 'older', time: 10 };
    const old = { id: 'old', time: 5 };
    const arrived = { id: 'arrived', time: 20 };
    expect(order([older, old], [arrived, older, old])).toEqual(['arrived', 'older', 'old']);
  });

  it('keeps captured rows in place while reading', () => {
    // A row the live sort or filters would move or hide stays where it was.
    const read = { id: 'read', time: 10 };
    const other = { id: 'other', time: 5 };
    expect(order([read, other], [read, other], [other])).toEqual(['read', 'other']);
  });

  it('moves a conversation that got a newer message since it was captured', () => {
    const top = { id: 'top', time: 10 };
    const replied = { id: 'replied', time: 30 };
    expect(order([top, { id: 'replied', time: 5 }], [replied, top])).toEqual(['replied', 'top']);
  });
});
