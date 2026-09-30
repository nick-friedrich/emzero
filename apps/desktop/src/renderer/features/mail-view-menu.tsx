import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Secondary mailbox controls stay together without crowding the title. */
export function MailViewMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  return (
    <div ref={root} className="macos-titlebar-no-drag relative shrink-0">
      <Button ref={trigger} variant="ghost" className="size-8 px-0"
        aria-label="View options" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((current) => !current)}>
        <SlidersHorizontal className="size-4" />
      </Button>
      {open && (
        <div id={id} role="group" aria-label="Mailbox view options"
          className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-border bg-card p-3 shadow-lg"
          onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
              setOpen(false);
            }
          }}>
          <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Layout & filters</p>
          <div className="flex flex-wrap items-center gap-1">{children}</div>
        </div>
      )}
    </div>
  );
}
