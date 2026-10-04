import Link from 'next/link';
import type { LiveCard } from '../../../features/watch/live-card';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { LiveClock } from '../live-clock/live-clock';

export type FeaturedDebateProps = {
  readonly card: LiveCard;
  readonly delaySeconds: number;
};

function Seat({ seat }: { seat: LiveCard['aff'] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 max-compact:w-full">
      <span className="text-2xs font-bold tracking-wider text-stage-ink-muted uppercase">
        {seat.label}
      </span>
      <span className="truncate text-lg font-bold">{`@${seat.handle}`}</span>
      <span className="text-sm text-stage-ink-muted tabular-nums">
        {`${seat.rating} ${seat.standing === 'est.' ? 'established' : 'provisional'}`}
      </span>
      <span className="text-sm text-stage-accent">
        {seat.speaking ? 'Speaking' : 'Listening'}
      </span>
    </div>
  );
}

/**
 * The featured live debate: the highest-rated ranked debate live now, picked
 * by rating alone. It sits on the stage surface so it leads the page.
 */
export function FeaturedDebate({ card, delaySeconds }: FeaturedDebateProps) {
  return (
    <section
      aria-label="Featured live debate"
      className="flex flex-col gap-4 rounded-xl bg-surface-stage p-6 text-stage-ink shadow-2 max-compact:p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-stage-ink-muted">
        <span className="font-bold text-stage-accent">Live</span>
        <span>{card.mode}</span>
        <span aria-hidden="true">·</span>
        <span>{card.rules}</span>
        <span className="ml-auto flex items-center gap-1 whitespace-nowrap tabular-nums">
          <Icon name="eye" size={16} />
          {`${card.watching} watching`}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-stage-ink-muted">Featured</span>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          {card.title}
        </h2>
      </div>
      <div className="flex items-center gap-6 max-compact:flex-col max-compact:items-stretch max-compact:gap-4">
        <Seat seat={card.aff} />
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm text-stage-ink-muted">{card.phaseName}</span>
          <LiveClock
            initialSeconds={card.secondsLeft}
            className="font-display text-2xl font-bold tabular-nums"
          />
          <span className="text-xs text-stage-ink-muted">{`delayed ${delaySeconds} s`}</span>
        </div>
        <Seat seat={card.neg} />
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {card.progress.map((step, index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-round',
              step === 'done' && 'bg-stage-accent',
              step === 'current' && 'bg-stage-accent opacity-50',
              step === 'upcoming' && 'bg-stage-ink-muted opacity-50',
            )}
          />
        ))}
      </div>
      <p className="text-base text-stage-ink-muted">
        <span className="font-strong text-stage-ink">{`@${card.speaker}`}</span>
        {` ${card.excerpt}`}
      </p>
      <Link
        href={card.href}
        className={cn(
          buttonClass('primary'),
          'self-start bg-stage-accent text-stage-accent-ink no-underline hover:bg-stage-accent-strong hover:no-underline max-compact:w-full',
        )}
      >
        Watch live
      </Link>
    </section>
  );
}
