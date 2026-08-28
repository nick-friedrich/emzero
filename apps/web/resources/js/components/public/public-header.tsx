import { Link } from '@inertiajs/react';
import AppLogoIcon from '@/components/app-logo-icon';
import { home } from '@/routes';
import { index as blogIndex } from '@/routes/blog';

export function PublicHeader() {
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

            <nav>
                <Link
                    href={blogIndex()}
                    className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
                >
                    Journal
                </Link>
            </nav>
        </header>
    );
}
