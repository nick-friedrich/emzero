import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AccountSummary } from '../../shared/accounts';
import { accountColorDotClass } from './account-colors';
import type { UnifiedAccountFailure } from './mail-common';

/** "All accounts" plus one chip per account, narrowing the unified list to one account. */
export function AccountFilterBar({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountSummary[];
  value: string | null;
  onChange: (accountId: string | null) => void;
}) {
  const chip = (active: boolean) => cn(
    'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-border bg-secondary font-medium text-foreground'
      : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
  );
  return (
    <div
      className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-4 py-2 lg:px-6"
      role="toolbar"
      aria-label="Filter by account"
    >
      <button type="button" className={chip(value === null)} aria-pressed={value === null} onClick={() => onChange(null)}>
        All accounts
      </button>
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          className={chip(value === account.id)}
          aria-pressed={value === account.id}
          title={account.email}
          onClick={() => onChange(value === account.id ? null : account.id)}
        >
          <span className={cn('size-2 rounded-full', accountColorDotClass(account.color))} aria-hidden="true" />
          {account.name}
        </button>
      ))}
    </div>
  );
}

/** Per-account load failures (error tone) or server notices, one line per account. */
export function AccountMessages({
  tone,
  messages,
}: {
  tone: 'error' | 'notice';
  messages: readonly UnifiedAccountFailure[];
}) {
  if (messages.length === 0) return null;
  return (
    <div className={cn(
      'border-b px-4 py-3 text-xs lg:px-6',
      tone === 'error'
        ? 'border-danger/20 bg-danger/8 text-danger'
        : 'border-border bg-secondary text-muted-foreground',
    )}>
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <div>
          {messages.map(({ account, message }) => (
            <p key={`${account.id}:${message}`} title={tone === 'error' ? message : undefined}>
              <span className="font-semibold">{account.name}:</span> {message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
