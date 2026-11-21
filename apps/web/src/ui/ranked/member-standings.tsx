import { ladderBoardHref } from '../../features/leaderboard/query';
import Link from 'next/link';
import type { SeasonHistoryRow } from '../../features/profile/season-history';
import type { MemberStanding } from '../../features/ratings/read-member';
import {
  markedRating,
  provisionalMarkClass,
} from '../../features/ratings/provisional-mark';
import { Badge } from '../components/badge/badge';
import { cn } from '../cn';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

/** A standing's figure, or the state it is in. */
export const standingFigure = (standing: MemberStanding): string => {
  if (standing.hidden) return 'Hidden while judging';
  if (standing.rating === null) return 'Unrated';
  return markedRating(standing.rating, standing.provisional);
};

/** True when the figure carries the provisional mark. */
export const markedProvisional = (standing: MemberStanding): boolean =>
  standing.provisional && standing.rating !== null && !standing.hidden;

/** "Final rating, Spring 2026. Kept as history." */
const historyLine = (standing: MemberStanding): string =>
  `Final rating, ${standing.season}. Kept as history.`;

/** "1604 · #12 of 388 · 31–12": rank only once established. */
export const seasonHistoryFacts = (row: SeasonHistoryRow): string =>
  [
    row.rank === null ? null : `#${row.rank} of ${row.of}`,
    `${row.wins}–${row.losses}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

function LadderCard({ standing }: { readonly standing: MemberStanding }) {
  const provisional = markedProvisional(standing);
  return (
    <li
      className={cn(
        'flex min-w-0 flex-1 basis-0 flex-col gap-3 rounded-md p-4',
        standing.current ? 'bg-surface-overlay' : 'bg-surface-sunken',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          href={ladderBoardHref(standing.ladder.division)}
          className="font-strong text-ink no-underline hover:underline"
        >
          Rating
        </Link>
        <span className="text-xs text-ink-muted">
          {standing.current ? `${standing.season} · current` : 'History'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'font-display text-2xl font-bold tabular-nums',
            provisional ? provisionalMarkClass : undefined,
          )}
          title={provisional ? 'Provisional rating' : undefined}
        >
          {standingFigure(standing)}
        </span>
        {provisional && standing.current ? (
          <Badge tone="neutral">Provisional</Badge>
        ) : null}
      </div>
      {standing.current ? null : (
        <p className="text-sm text-ink-muted">{historyLine(standing)}</p>
      )}
    </li>
  );
}

function SeasonHistory({
  rows,
}: {
  readonly rows: readonly SeasonHistoryRow[];
}) {
  return (
    <div className="flex flex-col">
      <h3 className="mb-1 text-sm font-strong text-ink">Season history</h3>
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
          >
            <span className="font-strong">{row.season}</span>
            <span className="text-ink-muted">
              <strong className="font-strong text-ink tabular-nums">
                {markedRating(row.rating, row.provisional)}
              </strong>
              {` · ${seasonHistoryFacts(row)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A profile's ratings (ADR 0162): one Freestyle card, then the seasons they
 * finished; no division is named. The caller chooses the card
 * (`profileLadders`).
 */
export function MemberStandings({
  standings,
  seasonHistory = [],
}: {
  readonly standings: readonly MemberStanding[];
  readonly seasonHistory?: readonly SeasonHistoryRow[];
}) {
  return (
    <section aria-label="Ratings" className={card}>
      <h2 className={heading}>Ratings</h2>
      {standings.length === 0 ? (
        <p className="text-sm text-ink-muted">Unrated</p>
      ) : (
        <ul className="flex gap-3 max-compact:flex-col">
          {standings.map((standing) => (
            <LadderCard key={standing.key} standing={standing} />
          ))}
        </ul>
      )}
      {seasonHistory.length === 0 ? null : (
        <SeasonHistory rows={seasonHistory} />
      )}
    </section>
  );
}
