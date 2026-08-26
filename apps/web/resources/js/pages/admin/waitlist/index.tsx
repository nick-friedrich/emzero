import { Form, Head, Link, usePage } from '@inertiajs/react';
import { Download, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { destroy, exportMethod, index } from '@/routes/admin/waitlist';
import type { Paginated } from '@/types';

type Subscriber = { id: number; email: string; created_at: string };

export default function WaitlistIndex({
    subscribers,
    filters,
}: {
    subscribers: Paginated<Subscriber>;
    filters: { search: string };
}) {
    const { flash } = usePage().props;

    return (
        <>
            <Head title="Waitlist" />
            <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <p className="text-sm text-muted-foreground">
                            Audience
                        </p>
                        <h1 className="text-3xl font-bold tracking-tight">
                            Waitlist
                        </h1>
                    </div>
                    <Button variant="outline" asChild>
                        <a href={exportMethod.url()}>
                            <Download /> Export CSV
                        </a>
                    </Button>
                </div>

                {flash.success && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                        {flash.success}
                    </div>
                )}

                <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
                    <div className="border-b p-4">
                        <Form {...index.form()} className="flex max-w-md gap-2">
                            <Input
                                name="search"
                                defaultValue={filters.search}
                                placeholder="Search email addresses"
                            />
                            <Button
                                type="submit"
                                variant="secondary"
                                aria-label="Search"
                            >
                                <Search />
                            </Button>
                        </Form>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
                                <tr>
                                    <th className="px-5 py-3 font-medium">
                                        Email
                                    </th>
                                    <th className="px-5 py-3 font-medium">
                                        Joined
                                    </th>
                                    <th className="px-5 py-3">
                                        <span className="sr-only">Actions</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {subscribers.data.map((subscriber) => (
                                    <tr key={subscriber.id}>
                                        <td className="px-5 py-4 font-medium">
                                            {subscriber.email}
                                        </td>
                                        <td className="px-5 py-4 text-muted-foreground">
                                            {new Date(
                                                subscriber.created_at,
                                            ).toLocaleString()}
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <Link
                                                href={destroy(subscriber.id)}
                                                method="delete"
                                                as="button"
                                                onBefore={() =>
                                                    window.confirm(
                                                        `Remove ${subscriber.email} from the waitlist?`,
                                                    )
                                                }
                                                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                aria-label={`Remove ${subscriber.email}`}
                                            >
                                                <Trash2 className="size-4" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                                {subscribers.data.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={3}
                                            className="px-5 py-12 text-center text-muted-foreground"
                                        >
                                            No subscribers found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between border-t px-5 py-4 text-sm text-muted-foreground">
                        <span>{subscribers.total} total</span>
                        <div className="flex gap-2">
                            {subscribers.links
                                .filter(
                                    (_, linkIndex) =>
                                        linkIndex === 0 ||
                                        linkIndex ===
                                            subscribers.links.length - 1,
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

WaitlistIndex.layout = { breadcrumbs: [{ title: 'Waitlist', href: index() }] };
