import Link from 'next/link';
import type { MemberStanding } from '../../features/ratings/read-member';
import {
  markedRating,
  provisionalMarkClass,
} from '../../features/ratings/provisional-mark';
import { Badge } from '../components/badge/badge';
import { cn } from '../cn';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

/** Profile and Round use the rating feature's published standing, without local calculation. */
export function MemberStandings({
  standings,
}: {
  readonly standings: readonly MemberStanding[];
}) {
  return (
    <section aria-label="Ratings" className={card}>
      <h2 className={heading}>Ratings</h2>
      {standings.length === 0 ? (
        <p className="text-sm text-ink-muted">No season is active.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 max-narrow:grid-cols-1">
          {standings.map((s) => (
            <li
              key={s.ladder}
              className="flex flex-col gap-3 rounded-md bg-surface-overlay p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/leaderboard?ladder=${s.ladder}`}
                  className="font-strong text-ink no-underline hover:underline"
                >
                  {s.ladder[0]!.toUpperCase() + s.ladder.slice(1)}
                </Link>
                <span className="text-xs text-ink-muted">{s.season}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'font-display text-2xl font-bold tabular-nums',
                    s.provisional && s.rating !== null
                      ? provisionalMarkClass
                      : undefined,
                  )}
                  title={
                    s.provisional && s.rating !== null
                      ? 'Provisional rating'
                      : undefined
                  }
                >
                  {s.hidden
                    ? 'Hidden while judging'
                    : s.rating === null
                      ? 'Unrated'
                      : markedRating(s.rating, s.provisional)}
                </span>
                {s.provisional && s.rating !== null ? (
                  <Badge tone="neutral">Provisional</Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
