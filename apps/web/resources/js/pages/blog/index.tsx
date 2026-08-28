import { Head, Link } from '@inertiajs/react';
import { PostCard } from '@/components/public/post-card';
import type { BlogPostSummary, Paginated } from '@/types';

export default function BlogIndex({
    posts,
}: {
    posts: Paginated<BlogPostSummary>;
}) {
    return (
        <>
            <Head title="Journal">
                <meta
                    name="description"
                    content="Product decisions, discoveries, and notes from building the Emzero desktop mail client."
                />
                <link rel="canonical" href="https://emzero.email/blog" />
            </Head>
            <main className="mx-auto flex min-h-[70vh] w-full max-w-7xl flex-col gap-12 px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
                <header className="flex max-w-3xl flex-col gap-5">
                    <p className="text-xs font-bold tracking-[0.2em] text-primary uppercase">
                        The journal
                    </p>
                    <h1 className="text-5xl font-black tracking-[-0.06em] sm:text-7xl">
                        Building email back from zero.
                    </h1>
                    <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                        Product decisions, tiny discoveries, and an honest
                        record of building a calmer mail client.
                    </p>
                </header>

                {posts.data.length > 0 ? (
                    <>
                        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                            {posts.data.map((post, index) => (
                                <PostCard
                                    key={post.id}
                                    post={post}
                                    index={index}
                                />
                            ))}
                        </div>
                        {posts.last_page > 1 && (
                            <nav
                                className="flex flex-wrap gap-2"
                                aria-label="Blog pagination"
                            >
                                {posts.links.map((link) =>
                                    link.url ? (
                                        <Link
                                            key={link.label}
                                            href={link.url}
                                            preserveScroll
                                            className={`rounded-full px-4 py-2 text-sm font-semibold ${link.active ? 'bg-primary text-primary-foreground' : 'border border-border bg-card'}`}
                                        >
                                            {link.label.includes('Previous')
                                                ? 'Previous'
                                                : link.label.includes('Next')
                                                  ? 'Next'
                                                  : link.label}
                                        </Link>
                                    ) : null,
                                )}
                            </nav>
                        )}
                    </>
                ) : (
                    <div className="rounded-[2rem] border border-dashed border-border p-12 text-muted-foreground">
                        The first note is still being written. Check back soon.
                    </div>
                )}
            </main>
        </>
    );
}
