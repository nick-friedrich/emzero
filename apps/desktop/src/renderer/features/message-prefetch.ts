import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface MessagePrefetchTarget {
  accountId: string;
  folderPath: string;
  uid: number;
}

const warmedMessages = new Set<string>();
const activePrefetches = new Map<string, Promise<void>>();

function targetKey(target: MessagePrefetchTarget): string {
  return `${target.accountId}\u0000${target.folderPath}\u0000${target.uid}`;
}

function prefetchMessage(target: MessagePrefetchTarget): Promise<void> {
  const key = targetKey(target);
  if (warmedMessages.has(key)) return Promise.resolve();
  const active = activePrefetches.get(key);
  if (active) return active;
  const request = window.emzero.messages
    .prefetch(target.accountId, target.folderPath, target.uid)
    .then((result) => {
      if (result.ok) warmedMessages.add(key);
    })
    .catch(() => undefined)
    .finally(() => activePrefetches.delete(key));
  activePrefetches.set(key, request);
  return request;
}

export function useMessagePrefetch(
  targets: MessagePrefetchTarget[],
  { warmNewest = true, disabled = false }: { warmNewest?: boolean; disabled?: boolean } = {},
) {
  const hoverTimers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!warmNewest || disabled) return;
    let active = true;
    const warmTargets = async () => {
      for (const target of targets.slice(0, 12)) {
        if (!active) return;
        await prefetchMessage(target);
      }
    };
    const idleCallback = window.requestIdleCallback(() => void warmTargets(), { timeout: 1_000 });
    return () => {
      active = false;
      window.cancelIdleCallback(idleCallback);
    };
  }, [disabled, targets, warmNewest]);

  useEffect(() => {
    const timers = hoverTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const prefetchSoon = useCallback((target: MessagePrefetchTarget) => {
    if (disabled) return;
    const key = targetKey(target);
    if (warmedMessages.has(key) || hoverTimers.current.has(key)) return;
    hoverTimers.current.set(
      key,
      window.setTimeout(() => {
        hoverTimers.current.delete(key);
        void prefetchMessage(target);
      }, 180),
    );
  }, [disabled]);

  const cancelPrefetch = useCallback((target: MessagePrefetchTarget) => {
    const key = targetKey(target);
    const timer = hoverTimers.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    hoverTimers.current.delete(key);
  }, []);

  const prefetchNow = useCallback((target: MessagePrefetchTarget) => {
    if (disabled) return;
    cancelPrefetch(target);
    void prefetchMessage(target);
  }, [cancelPrefetch, disabled]);

  return useMemo(
    () => ({ prefetchSoon, cancelPrefetch, prefetchNow }),
    [cancelPrefetch, prefetchNow, prefetchSoon],
  );
}
