import { Form, Link } from '@inertiajs/react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { index } from '@/routes/admin/posts';

type EditablePost = {
    id: number;
    title: string;
    excerpt: string;
    body: string;
    published_at: string | null;
};

type PostFormProps = {
    action: string;
    method: 'post';
    post?: EditablePost;
    submitLabel: string;
};

export function PostForm({ action, method, post, submitLabel }: PostFormProps) {
    return (
        <Form action={action} method={method} className="max-w-4xl">
            {({ errors, processing }) => (
                <div className="flex flex-col gap-7">
                    <div className="grid gap-6 rounded-xl border bg-card p-6 shadow-xs">
                        <label className="grid gap-2 text-sm font-medium">
                            Title
                            <Input
                                name="title"
                                defaultValue={post?.title}
                                required
                                autoFocus
                            />
                            {errors.title && (
                                <span className="text-sm text-destructive">
                                    {errors.title}
                                </span>
                            )}
                        </label>

                        <label className="grid gap-2 text-sm font-medium">
                            Excerpt
                            <textarea
                                name="excerpt"
                                defaultValue={post?.excerpt}
                                required
                                rows={3}
                                maxLength={500}
                                className="min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                            />
                            {errors.excerpt && (
                                <span className="text-sm text-destructive">
                                    {errors.excerpt}
                                </span>
                            )}
                        </label>

                        <label className="grid gap-2 text-sm font-medium">
                            Body
                            <textarea
                                name="body"
                                defaultValue={post?.body}
                                required
                                rows={18}
                                className="min-h-96 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm leading-7 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                            />
                            <span className="text-xs font-normal text-muted-foreground">
                                Plain text is rendered with paragraphs and line
                                breaks preserved.
                            </span>
                            {errors.body && (
                                <span className="text-sm text-destructive">
                                    {errors.body}
                                </span>
                            )}
                        </label>

                        <label className="grid max-w-xs gap-2 text-sm font-medium">
                            Status
                            <select
                                name="published"
                                defaultValue={post?.published_at ? '1' : '0'}
                                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                                <option value="0">Draft</option>
                                <option value="1">Published</option>
                            </select>
                            {errors.published && (
                                <span className="text-sm text-destructive">
                                    {errors.published}
                                </span>
                            )}
                        </label>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button type="submit" disabled={processing}>
                            {processing && (
                                <LoaderCircle className="animate-spin" />
                            )}
                            {submitLabel}
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href={index()}>Cancel</Link>
                        </Button>
                    </div>
                </div>
            )}
        </Form>
    );
}
