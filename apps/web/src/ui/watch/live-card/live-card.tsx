import Link from 'next/link';
import type { LiveCard as LiveCardModel } from '../../../features/watch/live-card';
import { buttonClass } from '../../components/button/button-class';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';
import { modeTextClass, progressStepClass } from './live-card-class';

export type LiveCardProps = {
  readonly card: LiveCardModel;
  readonly delaySeconds: number;
};

function Seat({ side, seat }: { side: string; seat: LiveCardModel['aff'] }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
        {side}
      </span>
      <span className="truncate text-base font-strong text-ink">{`@${seat.handle}`}</span>
      <span className="text-sm text-ink-faint tabular-nums">
        {`${seat.rating} ${seat.standing}`}
      </span>
    </span>
  );
}

/** One public live debate: who is speaking, how far along, one Watch link. */
export function LiveCard({ card, delaySeconds }: LiveCardProps) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <StatusLine tone="live">Live</StatusLine>
        <span className={modeTextClass(card.ranked)}>{card.mode}</span>
        <span aria-hidden="true">·</span>
        <span>{card.rules}</span>
        <span className="ml-auto whitespace-nowrap tabular-nums">
          {`${card.watching} watching`}
        </span>
      </div>
      <h3 className="truncate text-md font-bold text-ink">{card.title}</h3>
      <div className="flex flex-col gap-1">
        <Seat side="Aff" seat={card.aff} />
        <Seat side="Neg" seat={card.neg} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-1" aria-hidden="true">
          {card.progress.map((step, index) => (
            <span key={index} className={progressStepClass(step)} />
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          {`${card.phaseName} · @${card.speaker} speaking`}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-faint">{`Delayed ${delaySeconds} s`}</span>
        <Link
          href={card.href}
          aria-label={`Watch ${card.title}`}
          className={cn(
            buttonClass('secondary'),
            'no-underline hover:no-underline',
          )}
        >
          Watch
        </Link>
      </div>
    </article>
  );
}
