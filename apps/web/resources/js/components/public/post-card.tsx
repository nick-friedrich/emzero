import { Link } from '@inertiajs/react';
import { ArrowUpRight } from 'lucide-react';
import { show } from '@/routes/blog';
import type { BlogPostSummary } from '@/types';

export function PostCard({
    post,
    index = 0,
}: {
    post: BlogPostSummary;
    index?: number;
}) {
    const publishedAt = new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(post.published_at));

    return (
        <Link
            href={show(post.slug)}
            className="group flex h-full flex-col justify-between gap-10 rounded-[2rem] border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_24px_60px_rgba(36,71,122,0.12)] sm:p-8"
        >
            <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">
                    0{index + 1}
                </span>
                <ArrowUpRight className="size-5 text-muted-foreground transition group-hover:rotate-45 group-hover:text-primary" />
            </div>
            <div className="flex flex-col gap-4">
                <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
                    {publishedAt}
                </p>
                <h3 className="text-2xl font-bold tracking-[-0.04em] text-foreground">
                    {post.title}
                </h3>
                <p className="leading-7 text-muted-foreground">
                    {post.excerpt}
                </p>
            </div>
        </Link>
    );
}
