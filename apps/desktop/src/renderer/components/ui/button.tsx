import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'rounded-full bg-ink text-ink-foreground shadow-sm hover:bg-ink/85',
        destructive: 'rounded-full bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger',
        secondary: 'rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        /** Selected navigation item: a raised card on the shell surface. */
        raised: 'border border-border/70 bg-card text-foreground shadow-raised',
      },
      size: {
        default: 'h-9 px-3.5',
        lg: 'h-10 px-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, asChild, ref, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
