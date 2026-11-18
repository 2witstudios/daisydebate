import { ladderBoardHref } from '../../features/leaderboard/query';
import Link from 'next/link';
import type { RatingDivision } from '@daisy/protocol';
import {
  noLadderReason,
  rankedRoomLadder,
} from '../../features/play/ladder-division-words';
import { styleLabels } from '../../features/ratings/ladder-labels';
import type { MemberStanding } from '../../features/ratings/read-member';
import { provisionalMarkClass } from '../../features/ratings/provisional-mark';
import { Badge } from '../components/badge/badge';
import { Notice } from '../components/notice/notice';
import { cn } from '../cn';
import { markedProvisional, standingFigure } from './member-standings';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';
const ladderCard = 'flex flex-col gap-3 rounded-md bg-surface-overlay p-4';

/**
 * The member's one ranked rating, on their own lobby's ladder (ADR 0156):
 * this season's standing; a standing kept from an earlier season is no
 * rating this season.
 */
export const rankedLadderView = (
  standings: readonly MemberStanding[],
  division: RatingDivision,
) => {
  const standing =
    standings.find((s) => s.ladder.division === division && s.current) ?? null;
  return {
    ladder: rankedRoomLadder(division),
    // The active season's name, whether or not they are rated in it yet.
    season:
      standing?.season ?? standings.find((s) => s.current)?.season ?? null,
    standing,
  };
};

/**
 * The Ranked page's ratings, as YRanked and YRankedAdult draw them: one
 * Freestyle rating, no division named. With no age on record, the age prompt.
 */
export function RankedLadders({
  standings,
  division,
}: {
  readonly standings: readonly MemberStanding[];
  readonly division: RatingDivision | null;
}) {
  if (division === null)
    return <Notice tone="neutral" icon="lock" title={noLadderReason} />;
  const view = rankedLadderView(standings, division);
  const { standing } = view;
  const provisional = standing !== null && markedProvisional(standing);
  return (
    <section aria-label="Ratings" className={card}>
      <h2 className={heading}>Ratings</h2>
      <ul className="flex flex-col gap-3">
        <li className={ladderCard}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={ladderBoardHref(view.ladder.division)}
              className="font-strong text-ink no-underline hover:underline"
            >
              {styleLabels[view.ladder.style]}
            </Link>
            {view.season ? (
              <span className="text-xs text-ink-muted">{view.season}</span>
            ) : null}
          </div>
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'font-display text-2xl font-bold tabular-nums',
                provisional && provisionalMarkClass,
              )}
              title={provisional ? 'Provisional rating' : undefined}
            >
              {standing === null ? 'Unrated' : standingFigure(standing)}
            </span>
            {provisional ? <Badge tone="neutral">Provisional</Badge> : null}
          </span>
        </li>
      </ul>
    </section>
  );
}
