import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACCOUNT_COLORS, type AccountColor, type AccountSummary } from '../../shared/accounts';

// Full class names are listed so Tailwind can find them at build time.
const accountColorClasses: Record<AccountColor, string> = {
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
  orange: 'bg-orange-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-400',
  sky: 'bg-sky-400',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  indigo: 'bg-indigo-500',
};

export function accountColorDotClass(color: AccountColor): string {
  return accountColorClasses[color];
}

/** A small account-colored dot that reveals the account name and address on hover. */
export function AccountColorDot({
  account,
  className,
}: {
  account: Pick<AccountSummary, 'name' | 'email' | 'color'>;
  className?: string;
}) {
  return (
    <span className={cn('group/account relative inline-flex', className)}>
      <span
        className={cn(
          'block size-3 rounded-full ring-2 ring-card shadow-sm transition-transform group-hover/account:scale-125',
          accountColorDotClass(account.color),
        )}
        role="img"
        aria-label={`${account.name} (${account.email})`}
      />
      <span
        className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 flex -translate-y-1/2 translate-x-[-4px] items-center gap-2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs opacity-0 shadow-lg transition-all duration-150 group-hover/account:translate-x-0 group-hover/account:opacity-100"
        aria-hidden="true"
      >
        <span className={cn('size-2 rounded-full', accountColorDotClass(account.color))} />
        <span className="font-medium text-foreground">{account.name}</span>
        <span className="text-muted-foreground">{account.email}</span>
      </span>
    </span>
  );
}

export function AccountColorPicker({
  value,
  disabled,
  label,
  onChange,
}: {
  value: AccountColor;
  disabled?: boolean;
  label: string;
  onChange: (color: AccountColor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {ACCOUNT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          title={color}
          disabled={disabled}
          className={cn(
            'grid size-6 place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50',
            accountColorDotClass(color),
            value === color && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-card',
          )}
          onClick={() => onChange(color)}
        >
          {value === color && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}
