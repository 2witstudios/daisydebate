import Link from 'next/link';

export type ArticleListItem = {
  readonly href: string;
  readonly title: string;
  readonly summary: string;
};

/** Links to read next: each a title and its one-line summary. */
export function ArticleList({
  items,
  label,
}: {
  readonly items: readonly ArticleListItem[];
  readonly label: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.href} className="rounded-xl bg-surface p-5 shadow-1">
          <Link href={item.href} className="text-base font-bold">
            {item.title}
          </Link>
          <p className="mt-1 text-base leading-normal text-ink-muted">
            {item.summary}
          </p>
        </li>
      ))}
    </ul>
  );
}
