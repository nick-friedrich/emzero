import { Head, Link } from '@inertiajs/react';
import { FileText, Mail, PenLine, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { dashboard } from '@/routes';
import { create, index as postsIndex } from '@/routes/admin/posts';
import { index as waitlistIndex } from '@/routes/admin/waitlist';

type DashboardProps = {
    stats: {
        subscribers: number;
        publishedPosts: number;
        draftPosts: number;
    };
    recentSubscribers: Array<{ id: number; email: string; created_at: string }>;
    recentPosts: Array<{
        id: number;
        title: string;
        slug: string;
        published_at: string | null;
        updated_at: string;
    }>;
};

export default function AdminDashboard({
    stats,
    recentSubscribers,
    recentPosts,
}: DashboardProps) {
    const statCards: Array<[LucideIcon, string, number]> = [
        [Users, 'Waitlist', stats.subscribers],
        [FileText, 'Published posts', stats.publishedPosts],
        [PenLine, 'Drafts', stats.draftPosts],
    ];

    return (
        <>
            <Head title="Dashboard" />
            <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">Overview</p>
                    <h1 className="text-3xl font-bold tracking-tight">
                        Welcome back.
                    </h1>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                    {statCards.map(([Icon, label, value]) => (
                        <div
                            key={String(label)}
                            className="rounded-xl border bg-card p-5 shadow-xs"
                        >
                            <div className="mb-6 flex items-center justify-between">
                                <span className="text-sm font-medium text-muted-foreground">
                                    {String(label)}
                                </span>
                                <Icon className="size-4 text-muted-foreground" />
                            </div>
                            <p className="text-3xl font-bold tracking-tight">
                                {String(value)}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <section className="rounded-xl border bg-card shadow-xs">
                        <div className="flex items-center justify-between border-b p-5">
                            <div>
                                <h2 className="font-semibold">
                                    Recent subscribers
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    The newest people on the waitlist.
                                </p>
                            </div>
                            <Link
                                href={waitlistIndex()}
                                className="text-sm font-medium hover:underline"
                            >
                                View all
                            </Link>
                        </div>
                        <div className="divide-y">
                            {recentSubscribers.length > 0 ? (
                                recentSubscribers.map((subscriber) => (
                                    <div
                                        key={subscriber.id}
                                        className="flex items-center gap-3 p-4"
                                    >
                                        <span className="grid size-9 place-items-center rounded-full bg-muted">
                                            <Mail className="size-4" />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">
                                                {subscriber.email}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {new Date(
                                                    subscriber.created_at,
                                                ).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="p-5 text-sm text-muted-foreground">
                                    No subscribers yet.
                                </p>
                            )}
                        </div>
                    </section>

                    <section className="rounded-xl border bg-card shadow-xs">
                        <div className="flex items-center justify-between border-b p-5">
                            <div>
                                <h2 className="font-semibold">Recent posts</h2>
                                <p className="text-sm text-muted-foreground">
                                    Drafts and published stories.
                                </p>
                            </div>
                            <Link
                                href={postsIndex()}
                                className="text-sm font-medium hover:underline"
                            >
                                Manage
                            </Link>
                        </div>
                        <div className="divide-y">
                            {recentPosts.length > 0 ? (
                                recentPosts.map((post) => (
                                    <div
                                        key={post.id}
                                        className="flex items-center justify-between gap-4 p-4"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">
                                                {post.title}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                Updated{' '}
                                                {new Date(
                                                    post.updated_at,
                                                ).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <span
                                            className={`rounded-full px-2 py-1 text-xs font-medium ${post.published_at ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
                                        >
                                            {post.published_at
                                                ? 'Published'
                                                : 'Draft'}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="flex items-center justify-between gap-4 p-5">
                                    <p className="text-sm text-muted-foreground">
                                        No posts yet.
                                    </p>
                                    <Link
                                        href={create()}
                                        className="text-sm font-medium hover:underline"
                                    >
                                        Write one
                                    </Link>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}

AdminDashboard.layout = {
    breadcrumbs: [{ title: 'Dashboard', href: dashboard() }],
};
