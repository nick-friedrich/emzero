import { Head, Link, usePage } from '@inertiajs/react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { create, destroy, edit, index } from '@/routes/admin/posts';
import { show as publicPost } from '@/routes/blog';
import type { Paginated } from '@/types';

type AdminPost = {
    id: number;
    title: string;
    slug: string;
    published_at: string | null;
    updated_at: string;
};

export default function PostsIndex({ posts }: { posts: Paginated<AdminPost> }) {
    const { flash } = usePage().props;

    return (
        <>
            <Head title="Blog posts" />
            <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
                <div className="flex items-end justify-between gap-4">
                    <div>
                        <p className="text-sm text-muted-foreground">Content</p>
                        <h1 className="text-3xl font-bold tracking-tight">
                            Blog posts
                        </h1>
                    </div>
                    <Button asChild>
                        <Link href={create()}>
                            <Plus /> New post
                        </Link>
                    </Button>
                </div>

                {flash.success && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                        {flash.success}
                    </div>
                )}

                <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
                                <tr>
                                    <th className="px-5 py-3 font-medium">
                                        Post
                                    </th>
                                    <th className="px-5 py-3 font-medium">
                                        Status
                                    </th>
                                    <th className="px-5 py-3 font-medium">
                                        Updated
                                    </th>
                                    <th className="px-5 py-3">
                                        <span className="sr-only">Actions</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {posts.data.map((post) => (
                                    <tr key={post.id}>
                                        <td className="px-5 py-4 font-medium">
                                            {post.title}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span
                                                className={`rounded-full px-2 py-1 text-xs font-medium ${post.published_at ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
                                            >
                                                {post.published_at
                                                    ? 'Published'
                                                    : 'Draft'}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-muted-foreground">
                                            {new Date(
                                                post.updated_at,
                                            ).toLocaleString()}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex justify-end gap-1">
                                                {post.published_at && (
                                                    <Link
                                                        href={publicPost(
                                                            post.slug,
                                                        )}
                                                        className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                                                        aria-label={`View ${post.title}`}
                                                    >
                                                        <ExternalLink className="size-4" />
                                                    </Link>
                                                )}
                                                <Link
                                                    href={edit(post.id)}
                                                    className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                                                    aria-label={`Edit ${post.title}`}
                                                >
                                                    <Pencil className="size-4" />
                                                </Link>
                                                <Link
                                                    href={destroy(post.id)}
                                                    method="delete"
                                                    as="button"
                                                    onBefore={() =>
                                                        window.confirm(
                                                            `Delete “${post.title}”?`,
                                                        )
                                                    }
                                                    className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                    aria-label={`Delete ${post.title}`}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {posts.data.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={4}
                                            className="px-5 py-12 text-center text-muted-foreground"
                                        >
                                            No posts yet. Write the first one.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between border-t px-5 py-4 text-sm text-muted-foreground">
                        <span>{posts.total} total</span>
                        <div className="flex gap-2">
                            {posts.links
                                .filter(
                                    (_, linkIndex) =>
                                        linkIndex === 0 ||
                                        linkIndex === posts.links.length - 1,
                                )
                                .map((link, linkIndex) =>
                                    link.url ? (
                                        <Button
                                            key={linkIndex}
                                            variant="outline"
                                            size="sm"
                                            asChild
                                        >
                                            <Link href={link.url}>
                                                {linkIndex === 0
                                                    ? 'Previous'
                                                    : 'Next'}
                                            </Link>
                                        </Button>
                                    ) : (
                                        <Button
                                            key={linkIndex}
                                            variant="outline"
                                            size="sm"
                                            disabled
                                        >
                                            {linkIndex === 0
                                                ? 'Previous'
                                                : 'Next'}
                                        </Button>
                                    ),
                                )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

PostsIndex.layout = { breadcrumbs: [{ title: 'Blog posts', href: index() }] };
