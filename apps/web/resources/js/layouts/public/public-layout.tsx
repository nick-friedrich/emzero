import { Link } from '@inertiajs/react';
import type { PropsWithChildren } from 'react';
import AppLogoIcon from '@/components/app-logo-icon';
import { PublicHeader } from '@/components/public/public-header';
import { home } from '@/routes';
import { index as blogIndex } from '@/routes/blog';

export default function PublicLayout({ children }: PropsWithChildren) {
    return (
        <div className="min-h-screen overflow-hidden bg-[#f7f4ed] text-stone-950 selection:bg-[#ff5c35] selection:text-white">
            <PublicHeader />
            {children}
            <footer className="mx-auto flex w-full max-w-7xl flex-col gap-6 border-t border-stone-950/10 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
                <Link
                    href={home()}
                    className="flex items-center gap-2.5 text-lg font-black tracking-[-0.04em]"
                >
                    <AppLogoIcon className="size-9 object-contain drop-shadow-sm" />
                    emzero
                </Link>
                <div className="flex items-center gap-6 text-sm text-stone-500">
                    <Link href={blogIndex()} className="hover:text-stone-950">
                        Journal
                    </Link>
                    <span>© {new Date().getFullYear()} Emzero</span>
                </div>
            </footer>
        </div>
    );
}
