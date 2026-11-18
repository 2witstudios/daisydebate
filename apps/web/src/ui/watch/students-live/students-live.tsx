import Link from 'next/link';
import type { StudentLiveCard } from '../../../features/spectating/students-live';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';
import { modeBorderClass } from '../live-card/live-card-class';

export type StudentsLiveProps = {
  readonly cards: readonly StudentLiveCard[];
};

/**
 * "Your students, live" (ADR 0155): a linked coach's or parent's own view of
 * their students' running Youth Rounds, never part of the public listing.
 * Nothing renders for anyone with none.
 */
export function StudentsLive({ cards }: StudentsLiveProps) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="students-live" className="flex flex-col gap-3">
      <h2
        id="students-live"
        className="text-xs font-bold tracking-wide text-ink-muted uppercase"
      >
        Your students, live
      </h2>
      <ul className="grid grid-cols-3 gap-4 max-rail:grid-cols-2 max-compact:grid-cols-1">
        {cards.map((card) => (
          <li key={card.roundId} className="contents">
            <article
              className={cn(
                'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1',
                modeBorderClass(true),
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <StatusLine tone="live">Live</StatusLine>
                <Badge tone="clay">Ranked</Badge>
              </div>
              <h3 className="truncate text-md font-bold text-ink">
                {card.title}
              </h3>
              {card.resolution ? (
                <p className="line-clamp-2 text-sm text-ink-muted">
                  {card.resolution}
                </p>
              ) : null}
              <p className="text-sm text-ink-muted">{card.line}</p>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
