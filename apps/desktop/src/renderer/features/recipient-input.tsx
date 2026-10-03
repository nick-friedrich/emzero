import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MailSendDraft, RecipientSuggestion } from '../../shared/accounts';
import { parseAddressList } from '../../shared/replies';
import { avatarColorClass, avatarInitials } from './mail-common';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Format addresses as an editable, comma-separated list. */
export function editableAddressList(addresses: MailSendDraft['to']): string {
  return addresses.flatMap(({ name, address }) => {
    if (!address) return [];
    return name && !/[,;]/.test(name) ? [`${name} <${address}>`] : [address];
  }).join(', ');
}

/** Initial field value: known addresses become chips, leaving the input empty for typing. */
export function initialRecipientValue(addresses: MailSendDraft['to']): string {
  const list = editableAddressList(addresses);
  return list ? `${list}, ` : '';
}

/** Split a recipient list into committed addresses and the text still being typed. */
function splitRecipients(value: string): { committed: string; pending: string } {
  const separator = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
  return { committed: value.slice(0, separator + 1), pending: value.slice(separator + 1).trimStart() };
}

function withPending(addresses: MailSendDraft['to'], pending: string): string {
  const committed = editableAddressList(addresses);
  return committed ? `${committed}, ${pending}` : pending;
}

function suggestionText(suggestion: RecipientSuggestion): string {
  const safeName = suggestion.name && !/[,;]/.test(suggestion.name) ? suggestion.name : null;
  return safeName ? `${safeName} <${suggestion.address}>` : suggestion.address;
}

/**
 * A recipient row that shows committed addresses as removable chips. The value stays a plain
 * comma-separated list so drafts, validation, and autosave keep working on the same string.
 */
export function RecipientInput({
  label,
  accountId,
  value,
  placeholder,
  disabled,
  autoFocus,
  trailing,
  onChange,
}: {
  label: string;
  accountId: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  autoFocus?: boolean;
  trailing?: ReactNode;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const { committed, pending } = splitRecipients(value);
  const chips = parseAddressList(committed);
  const query = pending.trim();

  useEffect(() => {
    if (!focused || !accountId || !query) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void window.emzero.messages
        .suggestRecipients(accountId, query)
        .then((result) => {
          if (active) setSuggestions(result);
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [accountId, focused, query]);

  const commit = (text: string) => {
    onChange(withPending([...chips, ...parseAddressList(text)], ''));
    setSuggestions([]);
    setActiveIndex(0);
  };
  const open = focused && query.length > 0 && suggestions.length > 0;

  return (
    <div className="relative flex min-h-11 items-start gap-2 border-b border-border/70 px-4 py-1.5 sm:px-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          input.current?.focus();
        }
      }}>
      <label htmlFor={inputId} className="w-14 shrink-0 pt-[0.4rem] text-sm text-muted-foreground">{label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            input.current?.focus();
          }
        }}>
        {chips.map((chip, index) => {
          const address = chip.address ?? '';
          const valid = emailPattern.test(address.trim());
          const display = chip.name || address;
          return (
            <span
              key={`${address}-${index}`}
              title={chip.name ? `${chip.name} <${address}>` : address}
              className={cn(
                'flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-1 text-sm',
                valid ? 'border-border bg-secondary/70' : 'border-danger/50 bg-danger/10 text-danger',
              )}
            >
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[0.6rem] font-semibold',
                valid ? avatarColorClass(address.toLowerCase()) : 'bg-danger/15')}>
                {avatarInitials(display)}
              </span>
              <span className="truncate">{display}</span>
              <button
                type="button"
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                aria-label={`Remove ${display}`}
                disabled={disabled}
                onClick={() => {
                  onChange(withPending(chips.filter((_, candidate) => candidate !== index), pending));
                  input.current?.focus();
                }}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          id={inputId}
          className="h-8 min-w-36 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          type="text"
          value={pending}
          placeholder={chips.length === 0 ? placeholder : undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (emailPattern.test(parseAddressList(pending)[0]?.address?.trim() ?? '')) commit(pending);
          }}
          onChange={(event) => {
            onChange(`${committed}${committed && !/\s$/.test(committed) ? ' ' : ''}${event.target.value}`);
            setSuggestions([]);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (open && event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % suggestions.length);
            } else if (open && event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => (current === 0 ? suggestions.length - 1 : current - 1));
            } else if (open && (event.key === 'Enter' || event.key === 'Tab')) {
              event.preventDefault();
              commit(suggestionText(suggestions[activeIndex]));
            } else if (open && event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setSuggestions([]);
            } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && query) {
              event.preventDefault();
              commit(pending);
            } else if (event.key === 'Backspace' && !pending && chips.length > 0) {
              event.preventDefault();
              const last = chips.at(-1)!;
              onChange(withPending(chips.slice(0, -1), editableAddressList([last]) || (last.address ?? '')));
            }
          }}
        />
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-0.5 pt-0.5">{trailing}</div>}
      {open && (
        <div
          id={listId}
          className="absolute left-16 right-4 top-[calc(100%-0.25rem)] z-30 max-w-md overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg sm:left-[5.25rem]"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.address}
              type="button"
              className={cn(
                'flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-accent',
                index === activeIndex && 'bg-accent',
              )}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(suggestionText(suggestion))}
            >
              <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[0.65rem] font-semibold',
                avatarColorClass(suggestion.address.toLowerCase()))}>
                {avatarInitials(suggestion.name || suggestion.address)}
              </span>
              <span className="min-w-0">
                {suggestion.name && <span className="block truncate text-sm font-medium">{suggestion.name}</span>}
                <span className="block truncate text-xs text-muted-foreground">{suggestion.address}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
