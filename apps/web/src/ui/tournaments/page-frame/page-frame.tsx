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
