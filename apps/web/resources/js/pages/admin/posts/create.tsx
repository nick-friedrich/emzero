import { Head } from '@inertiajs/react';
import { PostForm } from '@/components/admin/post-form';
import { create, index, store } from '@/routes/admin/posts';

export default function CreatePost() {
    const form = store.form();

    return (
        <>
            <Head title="New post" />
            <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
                <div>
                    <p className="text-sm text-muted-foreground">Content</p>
                    <h1 className="text-3xl font-bold tracking-tight">
                        New post
                    </h1>
                </div>
                <PostForm
                    action={form.action}
                    method={form.method}
                    submitLabel="Create post"
                />
            </div>
        </>
    );
}

CreatePost.layout = {
    breadcrumbs: [
        { title: 'Blog posts', href: index() },
        { title: 'New post', href: create() },
    ],
};
