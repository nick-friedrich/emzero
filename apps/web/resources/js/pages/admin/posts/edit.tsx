import { Head } from '@inertiajs/react';
import { PostForm } from '@/components/admin/post-form';
import { index, update } from '@/routes/admin/posts';

type EditablePost = {
    id: number;
    title: string;
    slug: string;
    excerpt: string;
    body: string;
    published_at: string | null;
};

export default function EditPost({ post }: { post: EditablePost }) {
    const form = update.form(post.id);

    return (
        <>
            <Head title={`Edit ${post.title}`} />
            <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
                <div>
                    <p className="text-sm text-muted-foreground">Content</p>
                    <h1 className="text-3xl font-bold tracking-tight">
                        Edit post
                    </h1>
                </div>
                <PostForm
                    action={form.action}
                    method={form.method}
                    post={post}
                    submitLabel="Save changes"
                />
            </div>
        </>
    );
}

EditPost.layout = {
    breadcrumbs: [
        { title: 'Blog posts', href: index() },
        { title: 'Edit post', href: index() },
    ],
};
