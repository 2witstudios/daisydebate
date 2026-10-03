import Link from 'next/link';
import type { LiveCard as LiveCardModel } from '../../../features/watch/live-card';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';
import { modeBorderClass, progressStepClass } from './live-card-class';

export type LiveCardProps = {
  readonly card: LiveCardModel;
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

/**
 * One public live debate: its mode as a coloured chip (clay ranked, sky
 * casual), who is speaking, how far along, one Watch link. Standard rules are
 * the default and go unsaid; the delay is stated once for the whole page.
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
        {card.customRules ? <Badge tone="neutral">{card.rules}</Badge> : null}
        <span className="ml-auto flex items-center gap-1 whitespace-nowrap tabular-nums">
          <Icon name="eye" size={14} />
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
            <span
              key={index}
              className={progressStepClass(step, card.ranked)}
            />
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          {`${card.phaseName} · @${card.speaker} speaking`}
        </p>
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
