import { ladderBoardHref } from '../../features/leaderboard/query';
import Link from 'next/link';
import type { RatingDivision } from '@daisy/protocol';
import {
  ladderRoomsLine,
  lockedLadderLine,
  noLadderReason,
} from '../../features/play/ladder-division-words';
import {
  divisionAudiences,
  ladderLabel,
} from '../../features/ratings/ladder-labels';
import type { MemberStanding } from '../../features/ratings/read-member';
import { provisionalMarkClass } from '../../features/ratings/provisional-mark';
import { Badge } from '../components/badge/badge';
import { Icon } from '../components/icon/icon';
import { Notice } from '../components/notice/notice';
import { cn } from '../cn';
import { DivisionToneBadge } from '../ladder-badge/ladder-badge';
import { markedProvisional, standingFigure } from './member-standings';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';
const ladderCard = 'flex flex-col gap-3 rounded-md p-4';

const ladderOf = (division: RatingDivision) =>
  ({ style: 'freestyle', division }) as const;

/**
 * What the Ranked page shows of each ladder (ADR 0147): the member's own,
 * with this season's standing, and the other division's, locked. A standing
 * kept from an earlier season is no rating this season.
 */
export const rankedLadderView = (
  standings: readonly MemberStanding[],
  division: RatingDivision,
) => {
  const otherDivision: RatingDivision = division === 'youth' ? 'open' : 'youth';
  const currentOn = (each: RatingDivision) =>
    standings.find((s) => s.ladder.division === each && s.current) ?? null;
  const own = currentOn(division);
  const other = currentOn(otherDivision);
  const season = own?.season ?? other?.season ?? null;
  return {
    own: { ladder: ladderOf(division), season, standing: own },
    other: { ladder: ladderOf(otherDivision), season: other?.season ?? season },
  };
};

function OwnLadder({
  view,
}: {
  readonly view: ReturnType<typeof rankedLadderView>['own'];
}) {
  const { standing } = view;
  const provisional = standing !== null && markedProvisional(standing);
  return (
    <li className={cn(ladderCard, 'bg-surface-overlay')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Link
            href={ladderBoardHref(view.ladder.division)}
            className="font-strong text-ink no-underline hover:underline"
          >
            {ladderLabel(view.ladder)}
          </Link>
          <DivisionToneBadge division={view.ladder.division}>
            Your ladder
          </DivisionToneBadge>
        </span>
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
      <p className="text-sm text-ink-muted">
        {ladderRoomsLine(view.ladder.division)}
      </p>
    </li>
  );
}

function LockedOpenLadder({
  view,
}: {
  readonly view: ReturnType<typeof rankedLadderView>['other'];
}) {
  return (
    <li className={cn(ladderCard, 'bg-surface-sunken')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={ladderBoardHref(view.ladder.division)}
          className="font-strong text-ink-muted no-underline hover:underline"
        >
          {ladderLabel(view.ladder)}
        </Link>
        {view.season ? (
          <span className="text-xs text-ink-muted">{view.season}</span>
        ) : null}
      </div>
      <span className="flex items-center gap-2 font-display text-xl font-bold text-ink-muted">
        <Icon name="lock" size={18} />
        {divisionAudiences[view.ladder.division]}
      </span>
      <p className="text-sm text-ink-muted">
        {lockedLadderLine(view.ladder.division)}
      </p>
    </li>
  );
}

/**
 * The Ranked page's ladders, as YRanked and YRankedAdult draw them: a youth
 * member's Youth card and the Open card locked 18 and over; an adult's Open
 * card and a line that Youth is for members under 18. Never an age.
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
  return (
    <>
      <section aria-label="Ratings" className={card}>
        <h2 className={heading}>Ratings</h2>
        <ul className="flex flex-col gap-3">
          <OwnLadder view={view.own} />
          {division === 'youth' ? <LockedOpenLadder view={view.other} /> : null}
        </ul>
      </section>
      {division === 'open' ? (
        <div
          role="note"
          className="flex items-start gap-3 rounded-lg bg-hue-plum-soft px-4 py-3 text-base text-ink"
        >
          <Icon name="lock" size={18} className="mt-1 text-hue-plum" />
          <p>{lockedLadderLine('youth')}</p>
        </div>
      ) : null}
    </>
  );
}
