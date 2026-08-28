import { Head, Link } from '@inertiajs/react';
import { ArrowLeft } from 'lucide-react';
import { index } from '@/routes/blog';
import type { BlogPost } from '@/types';

export default function BlogShow({ post }: { post: BlogPost }) {
    const publishedAt = new Intl.DateTimeFormat('en', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(post.published_at));

    return (
        <>
            <Head title={post.title}>
                <meta name="description" content={post.excerpt} />
                <link
                    rel="canonical"
                    href={`https://emzero.email/blog/${post.slug}`}
                />
            </Head>
            <main className="mx-auto w-full max-w-4xl px-5 py-16 sm:px-8 lg:py-24">
                <Link
                    href={index()}
                    className="mb-12 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary"
                >
                    <ArrowLeft className="size-4" />
                    Back to the journal
                </Link>
                <article>
                    <header className="flex flex-col gap-6 border-b border-border pb-12">
                        <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
                            {publishedAt} · {post.author.name}
                        </p>
                        <h1 className="text-5xl leading-[1.02] font-black tracking-[-0.06em] text-balance sm:text-7xl">
                            {post.title}
                        </h1>
                        <p className="max-w-2xl text-xl leading-8 text-muted-foreground">
                            {post.excerpt}
                        </p>
                    </header>
                    <div className="py-12 text-lg leading-9 whitespace-pre-wrap text-foreground/85">
                        {post.body}
                    </div>
                </article>
            </main>
        </>
    );
}
