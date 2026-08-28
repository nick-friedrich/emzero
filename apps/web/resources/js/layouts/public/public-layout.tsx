import { Link, usePage } from '@inertiajs/react';
import type { PropsWithChildren } from 'react';
import AppLogoIcon from '@/components/app-logo-icon';
import { PublicHeader } from '@/components/public/public-header';
import { dashboard, home, login } from '@/routes';
import { index as blogIndex } from '@/routes/blog';

export default function PublicLayout({ children }: PropsWithChildren) {
    const { auth } = usePage().props;

    return (
        <div className="emzero-light-theme min-h-screen overflow-hidden bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
            <PublicHeader />
            {children}
            <footer className="mx-auto flex w-full max-w-7xl flex-col gap-6 border-t border-border px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
                <Link
                    href={home()}
                    className="flex items-center gap-2.5 text-lg font-black tracking-[-0.04em]"
                >
                    <AppLogoIcon className="size-9 object-contain drop-shadow-sm" />
                    emzero
                </Link>
                <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
                    <a
                        href="mailto:hello@emzero.email"
                        className="hover:text-foreground"
                    >
                        hello@emzero.email
                    </a>
                    <Link href={blogIndex()} className="hover:text-foreground">
                        Journal
                    </Link>
                    <Link
                        href={auth.user ? dashboard() : login()}
                        className="hover:text-foreground"
                    >
                        {auth.user ? 'Admin' : 'Admin login'}
                    </Link>
                    <span>© {new Date().getFullYear()} Emzero</span>
                </div>
            </footer>
        </div>
    );
}
