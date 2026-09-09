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
