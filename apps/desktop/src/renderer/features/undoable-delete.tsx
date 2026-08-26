import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const undoDelay = 5_000;

interface PendingDelete {
  id: number;
  timer: number;
  commit: () => Promise<string | null>;
  restore: () => void;
  onError: (message: string) => void;
}

export function useUndoableDelete() {
  const nextId = useRef(0);
  const pending = useRef<PendingDelete | null>(null);
  const [visibleId, setVisibleId] = useState<number | null>(null);

  const commit = async (item: PendingDelete) => {
    if (pending.current?.id === item.id) pending.current = null;
    setVisibleId((current) => (current === item.id ? null : current));
    const error = await item.commit().catch(() => 'The action could not be completed.');
    if (error) {
      item.restore();
      item.onError(error);
    }
  };

  const schedule = (
    commitAction: () => Promise<string | null>,
    restore: () => void,
    onError: (message: string) => void,
  ) => {
    const previous = pending.current;
    if (previous) {
      window.clearTimeout(previous.timer);
      void commit(previous);
    }
    const id = ++nextId.current;
    const item: PendingDelete = {
      id,
      commit: commitAction,
      restore,
      onError,
      timer: window.setTimeout(() => void commit(item), undoDelay),
    };
    pending.current = item;
    setVisibleId(id);
  };

  const undo = () => {
    const item = pending.current;
    if (!item) return;
    window.clearTimeout(item.timer);
    pending.current = null;
    setVisibleId(null);
    item.restore();
  };

  useEffect(
    () => () => {
      const item = pending.current;
      if (!item) return;
      window.clearTimeout(item.timer);
      void commit(item);
    },
    [],
  );

  const undoBar = visibleId === null ? null : (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground shadow-xl ring-1 ring-foreground/10">
      <span>Conversation deleted</span>
      <Button className="h-8 px-3" variant="ghost" onClick={undo}>Undo</Button>
    </div>
  );

  return { scheduleDelete: schedule, undoBar };
}
