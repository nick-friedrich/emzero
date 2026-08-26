export type BlogPostSummary = {
    id: number;
    title: string;
    slug: string;
    excerpt: string;
    published_at: string;
};

export type BlogPost = BlogPostSummary & {
    body: string;
    author: {
        id: number;
        name: string;
    };
};

export type PaginationLink = {
    url: string | null;
    label: string;
    active: boolean;
};

export type Paginated<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    from: number | null;
    to: number | null;
    total: number;
    links: PaginationLink[];
};
