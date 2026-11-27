/**
 * Decides what the reader keeps showing after a conversation leaves the list
 * through a delete or a move.
 *
 * The reader only follows a removal when it is showing the removed
 * conversation. Deleting a row that was never opened must leave the reader
 * untouched: in three-column layouts, opening the next conversation there
 * marks it read behind the user's back whenever "mark as read automatically"
 * is on.
 */
export function readerSelectionAfterRemoval<T>({
  current,
  keyOf,
  removedKey,
  selectNext,
  next,
}: {
  current: T | null;
  keyOf: (item: T) => string;
  removedKey: string;
  selectNext: boolean;
  next: T | null | undefined;
}): T | null {
  if (!current || keyOf(current) !== removedKey) return current;
  return selectNext ? (next ?? null) : null;
}

/**
 * Keeps the list order captured when a conversation was opened, so rows do not
 * jump while the user reads, and merges in conversations that arrived or got a
 * newer message since by date instead of leaving them below everything else.
 *
 * `captured` maps each key, in captured order, to its time when captured.
 * `current` holds every loaded item (including ones the live filters now hide,
 * which stay put while reading); `visible` is the live list, newest first.
 */
export function withReadingOrder<T>({
  captured,
  current,
  visible,
  keyOf,
  timeOf,
}: {
  captured: ReadonlyMap<string, number>;
  current: readonly T[];
  visible: readonly T[];
  keyOf: (item: T) => string;
  timeOf: (item: T) => number;
}): T[] {
  const byKey = new Map(current.map((item) => [keyOf(item), item]));
  const pinned = [...captured].flatMap(([key, time]) => {
    const item = byKey.get(key);
    return item && timeOf(item) <= time ? [item] : [];
  });
  const pinnedKeys = new Set(pinned.map(keyOf));
  const arrived = visible.filter((item) => !pinnedKeys.has(keyOf(item)));
  const merged: T[] = [];
  let pinnedIndex = 0;
  let arrivedIndex = 0;
  while (pinnedIndex < pinned.length && arrivedIndex < arrived.length) {
    merged.push(
      timeOf(arrived[arrivedIndex]) > timeOf(pinned[pinnedIndex])
        ? arrived[arrivedIndex++]
        : pinned[pinnedIndex++],
    );
  }
  return [...merged, ...pinned.slice(pinnedIndex), ...arrived.slice(arrivedIndex)];
}
