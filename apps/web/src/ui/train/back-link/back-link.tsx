import Link from 'next/link';
import type { ReactNode } from 'react';

/** The way back to where the flow started. */
export function BackLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 w-fit items-center gap-2 text-base font-strong text-ink-muted no-underline hover:text-ink hover:no-underline"
    >
      <span aria-hidden="true">&lsaquo;</span>
      {children}
    </Link>
  );
}
