import { useEffect, useEffectEvent, useRef, useState, type MouseEvent } from 'react';
import { keysInRange } from '@/lib/utils';
import { isEditableTarget } from './mail-common';

/**
 * Multi-select state and keyboard handling for a mail list whose rows are
 * identified by `keys` in display order: checkbox and Shift/Ctrl/Cmd clicks,
 * Escape, Ctrl/Cmd+A, Delete on the focused row, and arrow-key movement with
 * Shift to extend the range. Rows register their focusable button and delete
 * button in `rowRefs` and `deleteButtonRefs`.
 */
export function useListSelection(keys: readonly string[]) {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const clear = () => {
    setSelectedKeys(new Set());
    setAnchorKey(null);
    setCursorKey(null);
  };

  const selectAll = () => {
    setSelectedKeys(new Set(keys));
    setAnchorKey(keys[0] ?? null);
    setCursorKey(keys.at(-1) ?? null);
  };

  const toggleAll = () => {
    if (selectedKeys.size === keys.length) clear();
    else selectAll();
  };

  const toggle = (key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setAnchorKey(key);
    setCursorKey(key);
  };

  /** Checkbox change: Shift extends from the anchor, otherwise toggles the row. */
  const toggleChecked = (key: string, shiftKey: boolean) => {
    const anchorIndex = anchorKey ? keys.indexOf(anchorKey) : -1;
    if (shiftKey && anchorIndex >= 0) {
      setSelectedKeys(keysInRange(keys, anchorIndex, keys.indexOf(key)));
      setCursorKey(key);
      return;
    }
    toggle(key);
  };

  /** Applies Shift/Ctrl/Cmd row clicks; returns true when the click was a selection gesture. */
  const handleModifierClick = (event: MouseEvent, key: string): boolean => {
    if (event.shiftKey) {
      const targetIndex = keys.indexOf(key);
      const anchorIndex = anchorKey ? keys.indexOf(anchorKey) : targetIndex;
      setSelectedKeys(keysInRange(keys, anchorIndex, targetIndex));
      setAnchorKey(keys[anchorIndex]);
      setCursorKey(key);
      return true;
    }
    if (event.ctrlKey || event.metaKey) {
      toggle(key);
      return true;
    }
    return false;
  };

  useEffect(() => {
    const handleSelectionShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (event.key === 'Escape' && selectedKeys.size > 0) {
        event.preventDefault();
        setSelectedKeys(new Set());
        setAnchorKey(null);
        setCursorKey(null);
        return;
      }
      if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSelectedKeys(new Set(keys));
        setAnchorKey(keys[0] ?? null);
        setCursorKey(keys.at(-1) ?? null);
        return;
      }
      const cursorIndex = cursorKey ? keys.indexOf(cursorKey) : -1;
      if (event.key === 'Delete' && cursorIndex >= 0) {
        event.preventDefault();
        deleteButtonRefs.current.get(keys[cursorIndex])?.click();
        return;
      }
      if (!['ArrowUp', 'ArrowDown'].includes(event.key) || keys.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const clamp = (index: number) => Math.max(0, Math.min(keys.length - 1, index));
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const nextIndex = cursorIndex < 0 ? (step > 0 ? 0 : keys.length - 1) : clamp(cursorIndex + step);
        setCursorKey(keys[nextIndex]);
        rowRefs.current.get(keys[nextIndex])?.focus();
        return;
      }
      if (!event.shiftKey) return;
      event.preventDefault();
      let rangeCursorIndex = cursorKey ? cursorIndex : keys.findIndex((key) => selectedKeys.has(key));
      if (rangeCursorIndex < 0) rangeCursorIndex = step > 0 ? 0 : keys.length - 1;
      const anchorIndex = anchorKey ? keys.indexOf(anchorKey) : rangeCursorIndex;
      const nextIndex = clamp(rangeCursorIndex + step);
      const safeAnchorIndex = anchorIndex < 0 ? rangeCursorIndex : anchorIndex;
      setSelectedKeys(keysInRange(keys, safeAnchorIndex, nextIndex));
      setAnchorKey(keys[safeAnchorIndex]);
      setCursorKey(keys[nextIndex]);
      rowRefs.current.get(keys[nextIndex])?.focus();
    };
    window.addEventListener('keydown', handleSelectionShortcut);
    return () => window.removeEventListener('keydown', handleSelectionShortcut);
  }, [anchorKey, cursorKey, keys, selectedKeys]);

  return {
    selectedKeys,
    cursorKey,
    setCursorKey,
    rowRefs,
    deleteButtonRefs,
    clear,
    toggleAll,
    toggleChecked,
    handleModifierClick,
  };
}

/**
 * Ctrl+Q toggles read/unread on the focused row while `enabled` (no conversation
 * is open). `toggleFocusedRow` returns false when there is no row to toggle.
 */
export function useReadToggleShortcut(enabled: boolean, toggleFocusedRow: () => boolean) {
  const toggle = useEffectEvent(toggleFocusedRow);
  useEffect(() => {
    if (!enabled) return;
    const handleReadShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditableTarget(event.target) ||
        event.key.toLowerCase() !== 'q' ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if (toggle()) event.preventDefault();
    };
    window.addEventListener('keydown', handleReadShortcut);
    return () => window.removeEventListener('keydown', handleReadShortcut);
  }, [enabled]);
}
