import { Link, usePage } from '@inertiajs/react';
import { ArrowUpRight } from 'lucide-react';
import AppLogoIcon from '@/components/app-logo-icon';
import { dashboard, home, login } from '@/routes';
import { index as blogIndex } from '@/routes/blog';

export function PublicHeader() {
    const { auth } = usePage().props;

    return (
        <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
            <Link
                href={home()}
                className="flex items-center gap-2.5"
                aria-label="Emzero home"
            >
                <AppLogoIcon className="size-10 object-contain drop-shadow-sm" />
                <span className="text-lg font-bold tracking-[-0.04em]">
                    emzero
                </span>
            </Link>

            <nav className="flex items-center gap-2 sm:gap-6">
                <Link
                    href={blogIndex()}
                    className="hidden text-sm font-medium text-stone-600 transition hover:text-stone-950 sm:block"
                >
                    Journal
                </Link>
                <Link
                    href={auth.user ? dashboard() : login()}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-stone-950/15 bg-white/70 px-4 text-sm font-semibold shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-stone-950/30"
                >
                    {auth.user ? 'Admin' : 'Sign in'}
                    <ArrowUpRight className="size-4" />
                </Link>
            </nav>
        </header>
    );
}
