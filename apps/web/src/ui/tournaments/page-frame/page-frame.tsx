import type { ReactNode } from 'react';
import { Breadcrumb, type Crumb } from '../breadcrumb/breadcrumb';

/** The page column every tournaments screen sits in (same as the lobby). */
export function PageFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      {children}
    </div>
  );
}

/** A page title with an optional lede and trailing actions. */
export function PageHeader({
  title,
  lede,
  actions,
}: {
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {title}
        </h1>
        {lede ? <p className="text-base text-ink-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex gap-3">{actions}</div> : null}
    </header>
  );
}

/** Breadcrumb, the one h1 with its badges, and any lede under it. */
export function PageTitle({
  trail,
  title,
  badges,
  children,
}: {
  readonly trail: readonly Crumb[];
  readonly title: ReactNode;
  readonly badges?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Breadcrumb trail={trail} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {title}
        </h1>
        {badges}
      </div>
      {children}
    </div>
  );
}
