import Link from 'next/link';
import type { LiveCard } from '../../../features/watch/live-card';
import { buttonClass } from '../../components/button/button-class';
import { Badge } from '../../components/badge/badge';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';
import { LiveClock } from '../live-clock/live-clock';

export type FeaturedRoundProps = {
  readonly card: LiveCard;
};

function Seat({ seat }: { seat: LiveCard['aff'] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 max-compact:w-full">
      <span className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
        {seat.label}
      </span>
      <span className="truncate text-lg font-bold">
        {seat.name ?? 'Unnamed debater'}
      </span>
      <span className="text-sm text-accent">
        {seat.speaking ? 'Speaking' : 'Listening'}
      </span>
    </div>
  );
}

/**
 * The featured live Round: the newest ranked Round on the listing. It leads the
 * page on a wash of the ranked hue (clay, ADR 0051) instead of a flat green slab.
 */
export function FeaturedRound({ card }: FeaturedRoundProps) {
  return (
    <section
      aria-label="Featured live debate"
      className="flex flex-col gap-4 rounded-xl border border-border bg-hue-clay-soft p-6 text-ink shadow-1 max-compact:p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <StatusLine tone="live">Live</StatusLine>
        <Badge tone="clay">{card.mode}</Badge>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Featured</span>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          {card.title}
        </h2>
        {card.resolution ? (
          <p className="text-base text-ink-muted">{card.resolution}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-6 max-compact:flex-col max-compact:items-stretch max-compact:gap-4">
        <Seat seat={card.aff} />
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm text-ink-muted">{card.phaseName}</span>
          {card.secondsLeft === null ? null : (
            <LiveClock
              initialSeconds={card.secondsLeft}
              className="font-display text-2xl font-bold tabular-nums"
            />
          )}
        </div>
        <Seat seat={card.neg} />
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {card.progress.map((step, index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-round',
              step === 'done' && 'bg-hue-clay',
              step === 'current' && 'bg-hue-clay opacity-50',
              step === 'upcoming' && 'bg-surface-overlay',
            )}
          />
        ))}
      </div>
      <Link
        href={card.href}
        className={cn(
          buttonClass('primary'),
          'self-start no-underline hover:no-underline max-compact:w-full',
        )}
      >
        Watch live
      </Link>
    </section>
  );
}
