import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';

const mailListWidthStorageKey = 'emzero.mail-list-width';
const defaultMailListWidth = 384;
const minimumMailListWidth = 320;
const maximumMailListWidth = 640;
const minimumReaderWidth = 320;

function storedMailListWidth(): number {
  const stored = window.localStorage.getItem(mailListWidthStorageKey);
  if (stored === null) return defaultMailListWidth;
  const value = Number(stored);
  return Number.isFinite(value)
    ? Math.min(maximumMailListWidth, Math.max(minimumMailListWidth, value))
    : defaultMailListWidth;
}

export function MailSplitLayout({
  list,
  reader,
}: {
  list: ReactNode;
  reader: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(storedMailListWidth);

  useEffect(() => {
    window.localStorage.setItem(mailListWidthStorageKey, String(listWidth));
  }, [listWidth]);

  const constrainWidth = (width: number) => {
    const availableWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
    const availableMaximum = availableWidth > 0
      ? Math.max(minimumMailListWidth, availableWidth - minimumReaderWidth)
      : maximumMailListWidth;
    return Math.min(
      maximumMailListWidth,
      availableMaximum,
      Math.max(minimumMailListWidth, width),
    );
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const containerLeft = containerRef.current?.getBoundingClientRect().left ?? 0;
    const resize = (moveEvent: globalThis.PointerEvent) => {
      setListWidth(constrainWidth(moveEvent.clientX - containerLeft));
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  return (
    <div
      ref={containerRef}
      className="relative grid min-h-0 min-w-0 overflow-hidden"
      style={{ gridTemplateColumns: `${listWidth}px minmax(0, 1fr)` }}
    >
      <div className="min-h-0 min-w-0">{list}</div>
      <div className="min-h-0 min-w-0 bg-background">{reader}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize message list"
        aria-orientation="vertical"
        aria-valuemin={minimumMailListWidth}
        aria-valuemax={maximumMailListWidth}
        aria-valuenow={Math.round(listWidth)}
        className="group absolute inset-y-0 z-20 w-3 -translate-x-1/2 cursor-col-resize outline-none"
        style={{ left: listWidth }}
        onDoubleClick={() => setListWidth(constrainWidth(defaultMailListWidth))}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setListWidth((current) => constrainWidth(
            current + (event.key === 'ArrowRight' ? 16 : -16),
          ));
        }}
      >
        <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
      </div>
    </div>
  );
}

/** Empty reader pane shown beside the list until a conversation is opened. */
export function MailReaderPlaceholder({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="relative grid h-full place-items-center p-8 text-center text-muted-foreground">
      {window.emzero?.platform === 'darwin' && (
        <div className="macos-titlebar-drag absolute inset-x-0 top-0 h-12" aria-hidden="true" />
      )}
      <div>
        <Icon className="mx-auto size-8" />
        <p className="mt-3 text-sm">Select a conversation to read it here.</p>
      </div>
    </div>
  );
}
