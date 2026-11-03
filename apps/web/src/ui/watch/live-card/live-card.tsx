import Link from 'next/link';
import type { LiveCard as LiveCardModel } from '../../../features/watch/live-card';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';
import { modeBorderClass, progressStepClass } from './live-card-class';

export type LiveCardProps = {
  readonly card: LiveCardModel;
};

function Seat({ seat }: { seat: LiveCardModel['aff'] }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
        {seat.label}
      </span>
      <span className="truncate text-base font-strong text-ink">
        {seat.name ?? 'Unnamed debater'}
      </span>
      {seat.speaking ? (
        <span className="text-sm text-accent">Speaking</span>
      ) : null}
    </span>
  );
}

/**
 * One public live Round, as far as its released video has reached: its mode as
 * a coloured chip (clay ranked, sky casual), its resolution, who is speaking, how
 * far along, one Watch link.
 */
export function LiveCard({ card }: LiveCardProps) {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1',
        modeBorderClass(card.ranked),
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <StatusLine tone="live">Live</StatusLine>
        <Badge tone={card.ranked ? 'clay' : 'sky'}>{card.mode}</Badge>
      </div>
      <h3 className="truncate text-md font-bold text-ink">{card.title}</h3>
      {card.resolution ? (
        <p className="line-clamp-2 text-sm text-ink-muted">{card.resolution}</p>
      ) : null}
      <div className="flex flex-col gap-1">
        <Seat seat={card.aff} />
        <Seat seat={card.neg} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-1" aria-hidden="true">
          {card.progress.map((step, index) => (
            <span
              key={index}
              className={progressStepClass(step, card.ranked)}
            />
          ))}
        </div>
        <p className="text-sm text-ink-muted">{card.phaseName}</p>
      </div>
      <Link
        href={card.href}
        aria-label={`Watch ${card.title}`}
        className={cn(
          buttonClass('secondary'),
          'self-end no-underline hover:no-underline',
        )}
      >
        Watch
      </Link>
    </article>
  );
}
