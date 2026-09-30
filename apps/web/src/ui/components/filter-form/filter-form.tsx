import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass } from '../button/button-class';

/** "Clear" inside a filter panel: a link to the URL without the filters. */
export function ClearFilters({ href }: { readonly href: string }) {
  return (
    <Link
      href={href}
      className="order-9 flex min-h-10 items-center px-1 text-base font-strong max-compact:order-none"
    >
      Clear
    </Link>
  );
}

/**
 * The tail of a GET filter form: the result count (phone only), any extra
 * control such as a sort, and the Apply button that works without script.
 */
export function FilterFooter({
  resultLabel,
  children,
}: {
  readonly resultLabel: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="order-7 contents max-compact:order-5 max-compact:flex max-compact:basis-full max-compact:items-center max-compact:justify-between">
      <p className="hidden text-sm whitespace-nowrap text-ink-muted max-compact:block">
        {resultLabel}
      </p>
      {children}
      <button type="submit" className={`${buttonClass('secondary')} order-8`}>
        Apply
      </button>
    </div>
  );
}
