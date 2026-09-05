import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { interfaceFonts, messageThemeColors, themes, useTheme } from '@/theme';
import { cn } from '@/lib/utils';

export function appearanceShortcutLabel(): string {
  return window.emzero.platform === 'darwin' ? '⌘⇧P' : 'Ctrl+Shift+P';
}

export function AppearanceSwitcher() {
  const [open, setOpen] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const selectedTheme = useRef<HTMLInputElement | null>(null);
  const { theme, setTheme, interfaceFont, setInterfaceFont } = useTheme();

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      const modifier = window.emzero.platform === 'darwin'
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!modifier || !event.shiftKey || event.altKey || event.code !== 'KeyP' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (!open) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(!open);
    };
    window.addEventListener('keydown', toggle, true);
    return () => window.removeEventListener('keydown', toggle, true);
  }, [open]);

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent
      className="w-[min(28rem,calc(100%-2rem))] gap-4 p-5"
      onOpenAutoFocus={(event) => { event.preventDefault(); selectedTheme.current?.focus(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); previousFocus.current?.focus(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); setOpen(false); }
      }}
    >
      <DialogHeader>
        <DialogTitle>Quick appearance</DialogTitle>
        <DialogDescription>Changes apply instantly. Use arrow keys to switch and Tab to move between groups.</DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-1">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Color theme</legend>
        {themes.map(({ value, label }) => <label key={value} className={cn('relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', theme === value && 'bg-accent')}>
          <input ref={theme === value ? selectedTheme : undefined} className="sr-only" type="radio" name="quick-theme" value={value} checked={theme === value} onChange={() => setTheme(value)} />
          <span aria-hidden="true" className="size-4 rounded-full border border-border" style={{ background: messageThemeColors[value].background, boxShadow: `inset 0 0 0 4px ${messageThemeColors[value].primary}` }} />
          <span className="flex-1">{label}</span>
          {theme === value && <Check aria-hidden="true" className="size-4 text-primary" />}
        </label>)}
      </fieldset>
      <fieldset className="space-y-1 border-t border-border pt-3">
        <legend className="pr-2 text-xs font-medium text-muted-foreground">Interface font</legend>
        {interfaceFonts.map(({ value, label }) => <label key={value} className={cn('relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', interfaceFont === value && 'bg-accent')}>
          <input className="sr-only" type="radio" name="quick-font" value={value} checked={interfaceFont === value} onChange={() => setInterfaceFont(value)} />
          <span className="flex-1">{label}</span>
          {interfaceFont === value && <Check aria-hidden="true" className="size-4 text-primary" />}
        </label>)}
      </fieldset>
      <p className="text-xs text-muted-foreground">Enter or Esc to close · {appearanceShortcutLabel()} to toggle</p>
    </DialogContent>
  </Dialog>;
}
