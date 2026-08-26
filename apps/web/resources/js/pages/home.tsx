import { Head, Link } from '@inertiajs/react';
import { ArrowDown, Inbox, Layers3, ShieldCheck, Sparkles } from 'lucide-react';
import { PostCard } from '@/components/public/post-card';
import { WaitlistForm } from '@/components/public/waitlist-form';
import { index as blogIndex } from '@/routes/blog';
import type { BlogPostSummary } from '@/types';

export default function Home({ posts }: { posts: BlogPostSummary[] }) {
    return (
        <>
            <Head title="A calmer way to do email">
                <meta
                    name="description"
                    content="Emzero brings every inbox into one calm, focused workspace. Join the waitlist."
                />
            </Head>

            <main>
                <section className="relative mx-auto grid min-h-[calc(100vh-88px)] w-full max-w-7xl items-center gap-14 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-12 lg:py-20">
                    <div className="relative z-10 flex flex-col items-start gap-8">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#ff5c35]/25 bg-[#ff5c35]/10 px-3 py-1.5 text-xs font-bold tracking-[0.12em] text-[#b93818] uppercase">
                            <Sparkles className="size-3.5" />
                            Private beta opening soon
                        </div>
                        <div className="flex flex-col gap-6">
                            <h1 className="max-w-3xl text-5xl leading-[0.95] font-black tracking-[-0.065em] text-balance sm:text-7xl lg:text-[5.7rem]">
                                Email, minus the noise.
                            </h1>
                            <p className="max-w-xl text-lg leading-8 text-stone-600 sm:text-xl">
                                Emzero brings every inbox into one fast, private
                                workspace—so you can focus on people, not tabs.
                            </p>
                        </div>
                        <WaitlistForm />
                        <a
                            href="#why"
                            className="flex items-center gap-2 text-sm font-semibold text-stone-500"
                        >
                            See why we’re building it
                            <ArrowDown className="size-4" />
                        </a>
                    </div>

                    <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
                        <div className="absolute -top-16 -right-20 size-72 rounded-full bg-[#c8ff4d]/60 blur-3xl" />
                        <div className="absolute -bottom-20 -left-16 size-72 rounded-full bg-[#ff7d5d]/30 blur-3xl" />
                        <div className="relative rotate-[-1.5deg] overflow-hidden rounded-[2rem] border border-stone-950/10 bg-[#181714] p-3 shadow-[0_40px_100px_rgba(28,25,23,0.26)] sm:p-4">
                            <div className="flex items-center gap-2 px-3 py-2 text-stone-500">
                                <span className="size-2.5 rounded-full bg-[#ff5c35]" />
                                <span className="size-2.5 rounded-full bg-[#f5c451]" />
                                <span className="size-2.5 rounded-full bg-[#c8ff4d]" />
                            </div>
                            <div className="grid min-h-[430px] grid-cols-[88px_1fr] overflow-hidden rounded-2xl bg-[#f7f4ed] sm:grid-cols-[150px_1fr]">
                                <aside className="flex flex-col gap-3 border-r border-stone-950/10 bg-white/70 p-4">
                                    <div className="mb-3 flex items-center gap-2 text-sm font-black">
                                        <span className="grid size-7 place-items-center rounded-full bg-[#ff5c35] text-[10px] text-white">
                                            em
                                        </span>
                                        <span className="hidden sm:block">
                                            emzero
                                        </span>
                                    </div>
                                    {[
                                        'All inboxes',
                                        'Starred',
                                        'Sent',
                                        'Drafts',
                                    ].map((label, index) => (
                                        <div
                                            key={label}
                                            className={`rounded-lg px-2 py-2 text-xs ${index === 0 ? 'bg-stone-950 font-bold text-white' : 'text-stone-500'}`}
                                        >
                                            <span className="hidden sm:block">
                                                {label}
                                            </span>
                                            <span className="block h-2 rounded bg-current opacity-20 sm:hidden" />
                                        </div>
                                    ))}
                                </aside>
                                <div className="p-4 sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-stone-400">
                                                Good morning
                                            </p>
                                            <p className="text-lg font-black tracking-tight">
                                                Your inbox
                                            </p>
                                        </div>
                                        <div className="rounded-full bg-[#c8ff4d] px-3 py-1 text-xs font-black">
                                            12
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {[
                                            [
                                                'Maya Chen',
                                                'The latest product notes',
                                                '2m',
                                            ],
                                            [
                                                'Studio North',
                                                'Re: Monday’s review',
                                                '18m',
                                            ],
                                            [
                                                'Jon Bell',
                                                'A quick introduction',
                                                '1h',
                                            ],
                                            [
                                                'Paper Trail',
                                                'Your weekly reading list',
                                                '3h',
                                            ],
                                        ].map(
                                            ([name, subject, time], index) => (
                                                <div
                                                    key={subject}
                                                    className={`rounded-xl border p-3 sm:p-4 ${index === 0 ? 'border-[#ff5c35]/30 bg-white shadow-sm' : 'border-transparent bg-white/55'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-4">
                                                        <span className="text-sm font-bold">
                                                            {name}
                                                        </span>
                                                        <span className="text-[10px] text-stone-400">
                                                            {time}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 truncate text-xs text-stone-500">
                                                        {subject}
                                                    </p>
                                                </div>
                                            ),
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section
                    id="why"
                    className="border-y border-stone-950/10 bg-white/55"
                >
                    <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-12">
                        <div className="flex flex-col gap-5">
                            <p className="text-xs font-bold tracking-[0.2em] text-[#d94824] uppercase">
                                The idea
                            </p>
                            <h2 className="text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                                One place. Less friction.
                            </h2>
                        </div>
                        <div className="grid gap-5 sm:grid-cols-3">
                            {[
                                [
                                    Inbox,
                                    'One unified inbox',
                                    'Keep personal and work accounts together without losing context.',
                                ],
                                [
                                    Layers3,
                                    'Built for flow',
                                    'Search, write, and act without bouncing between browser tabs.',
                                ],
                                [
                                    ShieldCheck,
                                    'Private by design',
                                    'Your accounts stay yours. Emzero is built around local-first trust.',
                                ],
                            ].map(([Icon, title, copy]) => (
                                <article
                                    key={String(title)}
                                    className="flex flex-col gap-5 rounded-3xl border border-stone-950/10 bg-[#f7f4ed] p-6"
                                >
                                    <Icon className="size-7 text-[#ff5c35]" />
                                    <div className="flex flex-col gap-2">
                                        <h3 className="font-bold">
                                            {String(title)}
                                        </h3>
                                        <p className="text-sm leading-6 text-stone-600">
                                            {String(copy)}
                                        </p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                {posts.length > 0 && (
                    <section className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 py-24 sm:px-8 lg:px-12">
                        <div className="flex items-end justify-between gap-6">
                            <div className="flex flex-col gap-3">
                                <p className="text-xs font-bold tracking-[0.2em] text-[#d94824] uppercase">
                                    From the journal
                                </p>
                                <h2 className="text-4xl font-black tracking-[-0.05em]">
                                    Notes from the build.
                                </h2>
                            </div>
                            <Link
                                href={blogIndex()}
                                className="hidden text-sm font-bold underline underline-offset-4 sm:block"
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
                    </section>
                )}

                <section className="mx-auto w-full max-w-7xl px-5 pb-24 sm:px-8 lg:px-12">
                    <div className="relative overflow-hidden rounded-[2.5rem] bg-[#c8ff4d] px-6 py-16 sm:px-12 lg:px-20">
                        <div className="absolute -right-10 -bottom-20 text-[14rem] leading-none font-black text-stone-950/5">
                            @
                        </div>
                        <div className="relative flex max-w-2xl flex-col gap-7">
                            <p className="text-xs font-bold tracking-[0.2em] uppercase">
                                Early access
                            </p>
                            <h2 className="text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                                Be first in line for a calmer inbox.
                            </h2>
                            <WaitlistForm compact />
                        </div>
                    </div>
                </section>
            </main>
        </>
    );
}
