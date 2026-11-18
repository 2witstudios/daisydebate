import Link from 'next/link';
import type { ReactNode } from 'react';
import { DaisyLogo } from '../../components/daisy-mark/daisy-mark';

/**
 * The parent's pages (ADR 0151, boards "Parent signs" and "Signed and
 * withdraw"): Daisy's name and "No account needed" over the page, outside
 * the signed-in shell, because a parent has no account.
 */
export function ReleaseFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background wrap-anywhere text-ink">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-6 py-3 max-narrow:px-4">
        <Link
          href="/"
          className="flex min-h-release-target items-center gap-2 text-ink no-underline hover:no-underline"
        >
          <DaisyLogo />
          <span className="text-lg font-bold tracking-tight">Daisy Debate</span>
        </Link>
        <span className="text-sm text-ink-muted">No account needed</span>
      </header>
      <div className="mx-auto box-border w-full max-w-release-page px-6 pt-10 pb-16 max-narrow:px-4 max-narrow:pt-4">
        {children}
      </div>
    </div>
  );
}

/** A plain page for a link that cannot be used: a heading and what to do. */
export function ReleaseNotice({
  eyebrow = 'Media release',
  title,
  children,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex max-w-release-column flex-col gap-3">
      <span className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
        {eyebrow}
      </span>
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight wrap-anywhere">
        {title}
      </h1>
      <div className="flex flex-col gap-3 text-md text-ink-muted">
        {children}
      </div>
    </section>
  );
}
