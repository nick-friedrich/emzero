import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const undoDelay = 5_000;

interface PendingAction {
  id: number;
  message: string;
  timer: number;
  commit: () => Promise<string | null>;
  restore: () => void;
  onError: (message: string) => void;
}

export function useUndoableAction() {
  const nextId = useRef(0);
  const pending = useRef<PendingAction | null>(null);
  const [visibleAction, setVisibleAction] = useState<Pick<PendingAction, 'id' | 'message'> | null>(null);

  const commit = async (item: PendingAction) => {
    if (pending.current?.id === item.id) pending.current = null;
    setVisibleAction((current) => (current?.id === item.id ? null : current));
    const error = await item.commit().catch(() => 'The action could not be completed.');
    if (error) {
      item.restore();
      item.onError(error);
    }
  };

  const schedule = (
    message: string,
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
    const item: PendingAction = {
      id,
      message,
      commit: commitAction,
      restore,
      onError,
      timer: window.setTimeout(() => void commit(item), undoDelay),
    };
    pending.current = item;
    setVisibleAction({ id, message });
  };

  const undo = () => {
    const item = pending.current;
    if (!item) return;
    window.clearTimeout(item.timer);
    pending.current = null;
    setVisibleAction(null);
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

  const undoBar = visibleAction === null ? null : (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground shadow-xl ring-1 ring-foreground/10">
      <span>{visibleAction.message}</span>
      <Button className="h-8 px-3" variant="ghost" onClick={undo}>Undo</Button>
    </div>
  );

  return { scheduleAction: schedule, undoBar };
}
