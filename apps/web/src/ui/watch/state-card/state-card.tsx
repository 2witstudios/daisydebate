import type { ReactNode } from 'react';
import { Icon } from '../../components/icon/icon';
import type { IconName } from '../../components/icon/icons';

export type StateCardProps = {
  readonly icon: IconName;
  readonly title: string;
  /** `h1` when the card is the whole page, `h2` inside a list. */
  readonly level?: 'h1' | 'h2';
  readonly children: ReactNode;
  readonly actions?: ReactNode;
};

/** An empty, refused or in-between state: an icon, what happened, what next. */
export function StateCard({
  icon,
  title,
  level = 'h2',
  children,
  actions,
}: StateCardProps) {
  const Heading = level;
  return (
    <section className="mx-auto flex w-full max-w-auth-copy flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-1 max-compact:px-4">
      <span className="flex size-12 items-center justify-center rounded-round bg-accent-soft text-accent">
        <Icon name={icon} size={22} />
      </span>
      <Heading className="font-display text-xl font-bold tracking-tight text-ink">
        {title}
      </Heading>
      <div className="flex max-w-search flex-col gap-2 text-base text-ink-muted">
        {children}
      </div>
      {actions ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 max-compact:w-full max-compact:flex-col">
          {actions}
        </div>
      ) : null}
    </section>
  );
}
