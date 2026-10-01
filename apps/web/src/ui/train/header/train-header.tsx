import type { ReactNode } from 'react';
import { Icon } from '../../components/icon/icon';

export type TrainHeaderProps = {
  readonly title: string;
  readonly lede: ReactNode;
  /** The unrated reassurance pill; Train never touches a rating. */
  readonly unrated?: string;
};

/** A Train page's title row with the "never rated" promise beside it. */
export function TrainHeader({
  title,
  lede,
  unrated = 'Training never changes your rating',
}: TrainHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {title}
        </h1>
        <p className="text-base text-ink-muted">{lede}</p>
      </div>
      <p className="inline-flex items-center gap-2 rounded-round bg-accent-soft px-4 py-2 text-sm font-strong text-accent">
        <Icon name="check" size={16} />
        {unrated}
      </p>
    </header>
  );
}
