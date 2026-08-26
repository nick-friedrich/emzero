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
            className="group flex h-full flex-col justify-between gap-10 rounded-[2rem] border border-stone-950/10 bg-white p-6 transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(28,25,23,0.1)] sm:p-8"
        >
            <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-stone-400">
                    0{index + 1}
                </span>
                <ArrowUpRight className="size-5 text-stone-400 transition group-hover:rotate-45 group-hover:text-[#ff5c35]" />
            </div>
            <div className="flex flex-col gap-4">
                <p className="text-xs font-bold tracking-[0.18em] text-[#d94824] uppercase">
                    {publishedAt}
                </p>
                <h3 className="text-2xl font-bold tracking-[-0.04em] text-stone-950">
                    {post.title}
                </h3>
                <p className="leading-7 text-stone-600">{post.excerpt}</p>
            </div>
        </Link>
    );
}
