import type { ReactNode } from 'react';

export type PageHeaderProps = {
  readonly title: string;
  readonly lede?: string;
  /** A badge or action beside the title. */
  readonly aside?: ReactNode;
};

/** The h1 and its one-line lede, shared by every Judge screen. */
export function PageHeader({ title, lede, aside }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {title}
        </h1>
        {lede ? <p className="text-base text-ink-muted">{lede}</p> : null}
      </div>
      {aside}
    </header>
  );
}
