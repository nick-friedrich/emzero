import { Head, Link } from '@inertiajs/react';
import {
    ArrowDown,
    Inbox,
    Keyboard,
    Layers3,
    Palette,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { PostCard } from '@/components/public/post-card';
import { WaitlistForm } from '@/components/public/waitlist-form';
import { index as blogIndex } from '@/routes/blog';
import type { BlogPostSummary } from '@/types';

const features = [
    {
        icon: Inbox,
        title: 'Every inbox, together',
        copy: 'Keep personal and work accounts in one focused view without losing their identity.',
    },
    {
        icon: Keyboard,
        title: 'Built for keyboard flow',
        copy: 'Search, read, reply, and organize without reaching for another tab—or your mouse.',
    },
    {
        icon: ShieldCheck,
        title: 'Private by design',
        copy: 'Your mail stays yours. Emzero is designed around direct connections and local-first trust.',
    },
];

const themePreviews = [
    {
        name: 'Midnight blue',
        description: 'A focused blue palette for late-night inbox sessions.',
        src: '/brand/screenshots/emzero-app-dark-blue.webp',
    },
    {
        name: 'Soft violet',
        description: 'A warmer dark theme with a softer violet accent.',
        src: '/brand/screenshots/emzero-app-dark-violet.webp',
    },
];

export default function Home({ posts }: { posts: BlogPostSummary[] }) {
    return (
        <>
            <Head title="The email client for Linux">
                <meta
                    name="description"
                    content="A modern, private email client built first for Linux, with macOS support too. Bring every inbox into one focused desktop workspace."
                />
                <link rel="canonical" href="https://emzero.email/" />
                <meta property="og:type" content="website" />
                <meta
                    property="og:title"
                    content="Emzero — The email client for Linux"
                />
                <meta
                    property="og:description"
                    content="A modern, private email client built first for Linux, with macOS support too."
                />
                <meta property="og:url" content="https://emzero.email/" />
                <meta
                    property="og:image"
                    content="https://emzero.email/brand/screenshots/emzero-app-light.webp"
                />
                <meta name="twitter:card" content="summary_large_image" />
            </Head>

            <main>
                <section className="relative mx-auto flex w-full max-w-7xl flex-col items-center gap-12 px-5 pt-16 pb-20 text-center sm:px-8 lg:px-12 lg:pt-24">
                    <div className="pointer-events-none absolute top-0 left-1/2 -z-10 h-[34rem] w-[60rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
                    <div className="flex max-w-4xl flex-col items-center gap-7">
                        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-secondary px-3 py-1.5 text-xs font-bold tracking-[0.12em] text-primary uppercase">
                            <Sparkles className="size-3.5" />
                            Built for Linux · macOS too
                        </div>
                        <div className="flex flex-col items-center gap-6">
                            <h1 className="text-5xl leading-[0.96] font-black tracking-[-0.065em] text-balance sm:text-7xl lg:text-[5.8rem]">
                                A modern email client
                                <span className="block text-primary">
                                    for Linux. Finally.
                                </span>
                            </h1>
                            <p className="max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                                Emzero is a fast, private, multi-account desktop
                                mail client built for Linux—not ported there as
                                an afterthought. And yes, it runs on macOS too.
                            </p>
                        </div>
                        <div className="w-full max-w-2xl text-left">
                            <WaitlistForm />
                        </div>
                        <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                            Coming to emzero.email
                        </p>
                    </div>

                    <figure className="relative w-full">
                        <div className="absolute inset-x-[10%] bottom-0 -z-10 h-1/2 rounded-full bg-primary/20 blur-3xl" />
                        <div className="overflow-hidden rounded-[1.6rem] border border-border bg-card p-1.5 shadow-[0_34px_100px_rgba(36,71,122,0.20)] sm:rounded-[2rem] sm:p-2.5">
                            <img
                                src="/brand/screenshots/emzero-app-light.webp"
                                alt="Emzero desktop app showing a unified inbox, message list, and conversation reader in the light theme"
                                width={1600}
                                height={1063}
                                fetchPriority="high"
                                className="h-auto w-full rounded-[1.15rem] sm:rounded-[1.45rem]"
                            />
                        </div>
                        <figcaption className="mt-5 text-sm text-muted-foreground">
                            A real desktop mail workspace for Linux, with every
                            account together and no browser tabs required.
                        </figcaption>
                    </figure>

                    <a
                        href="#why"
                        className="flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-primary"
                    >
                        See what makes it different
                        <ArrowDown className="size-4" />
                    </a>
                </section>

                <section id="why" className="border-y border-border bg-card/65">
                    <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-12">
                        <div className="flex flex-col gap-5">
                            <p className="text-xs font-bold tracking-[0.2em] text-primary uppercase">
                                The idea
                            </p>
                            <h2 className="text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                                Linux deserves a great email client.
                            </h2>
                            <p className="max-w-md leading-7 text-muted-foreground">
                                Emzero is designed around the Linux desktop from
                                day one, while keeping the same polished
                                experience available on macOS.
                            </p>
                        </div>
                        <div className="grid gap-5 sm:grid-cols-3">
                            {features.map(({ icon: Icon, title, copy }) => (
                                <article
                                    key={title}
                                    className="flex flex-col gap-5 rounded-3xl border border-border bg-background p-6"
                                >
                                    <div className="grid size-11 place-items-center rounded-2xl bg-secondary text-primary">
                                        <Icon className="size-6" />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <h3 className="font-bold">{title}</h3>
                                        <p className="text-sm leading-6 text-muted-foreground">
                                            {copy}
                                        </p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-5 py-24 sm:px-8 lg:px-12">
                    <div className="flex max-w-3xl flex-col items-start gap-6">
                        <div className="grid size-12 place-items-center rounded-2xl bg-secondary text-primary">
                            <Palette className="size-6" />
                        </div>
                        <div className="flex flex-col gap-4">
                            <p className="text-xs font-bold tracking-[0.2em] text-primary uppercase">
                                Make it yours
                            </p>
                            <h2 className="text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                                Calm looks different to everyone.
                            </h2>
                            <p className="max-w-md leading-7 text-muted-foreground">
                                Choose the theme and typeface that feel right,
                                while every layout and shortcut stays familiar.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-10">
                        {themePreviews.map((theme) => (
                            <figure
                                key={theme.name}
                                className="overflow-hidden rounded-[2rem] border border-border bg-card p-2.5 shadow-[0_24px_70px_rgba(36,71,122,0.14)] sm:p-3"
                            >
                                <img
                                    src={theme.src}
                                    alt={`Emzero desktop app using the ${theme.name} theme`}
                                    width={1600}
                                    height={1063}
                                    loading="lazy"
                                    className="h-auto w-full rounded-[1.4rem]"
                                />
                                <figcaption className="flex flex-col gap-1 px-3 py-4 text-left sm:px-5">
                                    <span className="flex items-center gap-2 font-bold">
                                        <span className="size-2 rounded-full bg-primary" />
                                        {theme.name}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                        {theme.description}
                                    </span>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </section>

                {posts.length > 0 && (
                    <section className="border-y border-border bg-card/65">
                        <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 py-24 sm:px-8 lg:px-12">
                            <div className="flex items-end justify-between gap-6">
                                <div className="flex flex-col gap-3">
                                    <p className="text-xs font-bold tracking-[0.2em] text-primary uppercase">
                                        From the journal
                                    </p>
                                    <h2 className="text-4xl font-black tracking-[-0.05em]">
                                        Notes from the build.
                                    </h2>
                                </div>
                                <Link
                                    href={blogIndex()}
                                    className="hidden text-sm font-bold text-primary underline underline-offset-4 sm:block"
                                >
                                    Read all posts
                                </Link>
                            </div>
                            <div className="grid gap-5 md:grid-cols-3">
                                {posts.map((post, index) => (
                                    <PostCard
                                        key={post.id}
                                        post={post}
                                        index={index}
                                    />
                                ))}
                            </div>
                        </div>
                    </section>
                )}

                <section className="mx-auto w-full max-w-7xl px-5 py-24 sm:px-8 lg:px-12">
                    <div className="relative overflow-hidden rounded-[2.5rem] border border-primary/15 bg-accent px-6 py-16 sm:px-12 lg:px-20">
                        <div className="absolute -right-10 -bottom-20 text-[14rem] leading-none font-black text-primary/5">
                            @
                        </div>
                        <div className="relative flex max-w-2xl flex-col gap-7">
                            <div className="flex items-center gap-2 text-primary">
                                <Layers3 className="size-5" />
                                <p className="text-xs font-bold tracking-[0.2em] uppercase">
                                    Early access
                                </p>
                            </div>
                            <h2 className="text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                                Join the Linux-first email client waitlist.
                            </h2>
                            <WaitlistForm compact />
                        </div>
                    </div>
                </section>
            </main>
        </>
    );
}
