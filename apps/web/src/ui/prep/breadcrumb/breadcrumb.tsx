import Link from 'next/link';

export type Crumb = { readonly label: string; readonly href?: string };

/** A breadcrumb trail; the last crumb is the page, not a link. */
export function Breadcrumb({ crumbs }: { readonly crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
      <ol className="flex flex-wrap items-center gap-2">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.label} className="flex items-center gap-2">
              {last || crumb.href === undefined ? (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={last ? 'font-strong text-ink' : ''}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href}>{crumb.label}</Link>
              )}
              {last ? null : <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
