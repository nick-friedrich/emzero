import { Form, usePage } from '@inertiajs/react';
import { ArrowRight, Check } from 'lucide-react';
import { store } from '@/routes/waitlist';

export function WaitlistForm({ compact = false }: { compact?: boolean }) {
    const { flash } = usePage().props;

    return (
        <Form {...store.form()} resetOnSuccess className="w-full">
            {({ errors, processing, wasSuccessful }) => (
                <div className="flex flex-col gap-3">
                    <div
                        className={`flex gap-2 rounded-2xl border border-border bg-card p-2 shadow-[0_18px_60px_rgba(36,71,122,0.10)] ${compact ? 'max-w-xl' : 'max-w-2xl'}`}
                    >
                        <label
                            htmlFor={compact ? 'footer-email' : 'hero-email'}
                            className="sr-only"
                        >
                            Email address
                        </label>
                        <input
                            id={compact ? 'footer-email' : 'hero-email'}
                            name="email"
                            type="email"
                            required
                            autoComplete="email"
                            placeholder="you@example.com"
                            aria-invalid={errors.email ? true : undefined}
                            className="min-w-0 flex-1 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                        />
                        <input
                            name="website"
                            type="text"
                            tabIndex={-1}
                            autoComplete="off"
                            className="hidden"
                            aria-hidden="true"
                        />
                        <button
                            type="submit"
                            disabled={processing}
                            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 sm:px-6"
                        >
                            <span className="hidden sm:inline">
                                Join the waitlist
                            </span>
                            <span className="sm:hidden">Join</span>
                            <ArrowRight className="size-4" />
                        </button>
                    </div>
                    {errors.email ? (
                        <p className="text-sm font-medium text-red-700">
                            {errors.email}
                        </p>
                    ) : wasSuccessful || flash.success ? (
                        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                            <Check className="size-4" />
                            {flash.success ?? "You're on the list."}
                        </p>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            No noise. Just thoughtful product updates.
                        </p>
                    )}
                </div>
            )}
        </Form>
    );
}
