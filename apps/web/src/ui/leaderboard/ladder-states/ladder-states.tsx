import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Champion } from '../../../features/leaderboard/ladder-view';
import { leaderboardDestinations } from '../../../features/leaderboard/actions';
import {
  seasonDates,
  seasonLabel,
  seasonProgress,
  type Season,
} from '../../../features/leaderboard/season';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';

const link = 'no-underline hover:no-underline';
const card = 'rounded-lg border border-border bg-surface p-5 shadow-1';

/** Shown in place of the table when the ladder cannot be read. */
export function LadderError({
  retryHref,
  onRetry,
}: {
  readonly retryHref: string;
  /** With script, the boundary's retry; without, the link reloads the page. */
  readonly onRetry?: () => void;
}) {
  return (
    <section
      role="alert"
      className={cn(card, 'flex flex-col items-center gap-3 py-8 text-center')}
    >
      <Icon name="alert" size={28} className="text-ink-faint" />
      <h2 className="text-lg font-bold">The ladder could not load</h2>
      <p className="text-base text-ink-muted">
        Your season and filters are kept. Try again in a moment.
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={buttonClass('secondary')}
        >
          Try again
        </button>
      ) : (
        <Link href={retryHref} className={cn(buttonClass('secondary'), link)}>
          Try again
        </Link>
      )}
    </section>
  );
}

const skeletonRows = [0, 1, 2, 3, 4, 5, 6] as const;

/** Placeholder rows while the ladder loads; the region is announced as busy. */
export function LadderSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the ladder"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
    >
      {skeletonRows.map((row) => (
        <div
          key={row}
          className="flex items-center gap-4 border-t border-border px-5 py-4 first:border-t-0"
        >
          <span className="h-4 w-6 rounded-sm bg-surface-overlay" />
          <span className="h-4 flex-1 rounded-sm bg-surface-overlay" />
          <span className="h-4 w-12 rounded-sm bg-surface-overlay" />
        </div>
      ))}
    </div>
  );
}

/** What a judge sees while assigned: the two debaters are masked. */
export function JudgeNotice() {
  return (
    <p
      role="note"
      className="flex items-center gap-3 rounded-lg border border-border bg-surface-overlay px-4 py-3 text-base text-ink-muted"
    >
      <Icon name="eye" size={20} />
      Ratings are hidden while you judge. The two debaters in your current
      debate stay hidden until you submit your ballot.
    </p>
  );
}

/** Standings changed on the feed; the viewer chooses when to refresh. */
export function LiveNotice({
  changes,
  refreshHref,
}: {
  readonly changes: number;
  readonly refreshHref: string;
}) {
  if (changes === 0) return null;
  return (
    <p className="flex items-center gap-3 text-sm" role="status">
      <Badge tone="live">Live</Badge>
      <Link href={refreshHref} className="font-strong">
        {`${changes} ${changes === 1 ? 'rank' : 'ranks'} changed. Refresh`}
      </Link>
    </p>
  );
}

export function FinalBanner({ season }: { readonly season: Season }) {
  return (
    <p className="flex items-center gap-3 rounded-lg border border-gold-border bg-gold-soft px-4 py-3 text-base">
      <Badge tone="gold">Final</Badge>
      {`${seasonLabel(season)} is closed. These standings will not change.`}
    </p>
  );
}

export function EarlyBanner({
  season,
  now,
  established,
  provisional,
}: {
  readonly season: Season;
  readonly now: string;
  readonly established: number;
  readonly provisional: number;
}) {
  const { day } = seasonProgress(season, now);
  return (
    <p className="rounded-lg border border-border bg-surface-overlay px-4 py-3 text-base text-ink-muted">
      {`Day ${day} of ${seasonLabel(season)}. ${established} ${established === 1 ? 'debater is' : 'debaters are'} established and ${provisional} ${provisional === 1 ? 'is' : 'are'} provisional. Showing everyone.`}
    </p>
  );
}

/** The top of a season that has just opened. */
export function NewSeasonHero({
  season,
  now,
}: {
  readonly season: Season;
  readonly now: string;
}) {
  const { day } = seasonProgress(season, now);
  return (
    <section
      className={cn(
        card,
        'flex items-center justify-between gap-6 max-compact:flex-col max-compact:items-start',
      )}
    >
      <div className="flex flex-col gap-2">
        <Badge tone="accent">{`Day ${day}`}</Badge>
        <h2 className="font-display text-2xl font-bold">
          {`${seasonLabel(season)} has started`}
        </h2>
        <p className="text-base text-ink-muted">
          Everyone starts provisional at the starting rating. The ladder fills
          in as debaters finish their first ranked debates.
        </p>
      </div>
      <Link
        href={leaderboardDestinations.findMatch}
        className={cn(buttonClass('primary'), link, 'max-compact:w-full')}
      >
        Find a match
      </Link>
    </section>
  );
}

export function PreviousChampion({
  champion,
}: {
  readonly champion: Champion;
}) {
  return (
    <section
      aria-label="Last season’s champion"
      className={cn(card, 'flex items-center gap-4')}
    >
      <Icon name="trophy" size={28} className="text-gold" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
          {`Season ${champion.season} champion`}
        </span>
        <span className="truncate text-lg font-bold">{`@${champion.username}`}</span>
      </div>
      <span className="font-display text-xl font-bold tabular-nums">
        {champion.rating}
      </span>
    </section>
  );
}

export type EmptyKind = 'filtered' | 'provisional-hits' | 'new-season';

export type EmptyLadderProps = {
  readonly kind: EmptyKind;
  readonly provisionalHits: number;
  readonly clearHref: string;
  readonly everyoneHref: string;
  /** The previous season's ladder, for a season with nobody ranked. */
  readonly previousSeasonHref: string | null;
  readonly previousSeason: number | null;
};

/** The ladder's empty body; it never leaves a dead end. */
export function EmptyLadder(props: EmptyLadderProps): ReactNode {
  const secondary = cn(buttonClass('secondary'), link);
  return (
    <div className="flex flex-col items-center gap-3 border-t border-border px-5 py-8 text-center text-base text-ink-muted">
      <Icon name="chart" size={28} className="text-ink-faint" />
      {props.kind === 'new-season' ? (
        <>
          <h2 className="text-lg font-bold text-ink">No one is ranked yet</h2>
          <p>
            A debater appears here with a rank once their rating is established.
            Provisional debaters are listed under Everyone, without a rank.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={props.everyoneHref} className={secondary}>
              Show provisional debaters
            </Link>
            {props.previousSeasonHref ? (
              <Link href={props.previousSeasonHref} className={secondary}>
                {`See Season ${props.previousSeason} final standings`}
              </Link>
            ) : null}
          </div>
        </>
      ) : props.kind === 'provisional-hits' ? (
        <>
          <p>
            {`No established debater matches this search. ${props.provisionalHits} provisional ${props.provisionalHits === 1 ? 'debater matches' : 'debaters match'}.`}
          </p>
          <Link href={props.everyoneHref} className={secondary}>
            Show provisional debaters
          </Link>
        </>
      ) : (
        <>
          <p>No debaters match these filters.</p>
          <Link href={props.clearHref} className={secondary}>
            Clear filters
          </Link>
        </>
      )}
    </div>
  );
}

/** "This season" and "How ratings work", beside the table on wide screens. */
export function seasonEnds(season: Season, now: string): string {
  const { day, length } = seasonProgress(season, now);
  const left = length - day;
  return `${seasonDates(season)}. ${left === 0 ? 'Ends today.' : `Ends in ${left} ${left === 1 ? 'day' : 'days'}.`}`;
}
