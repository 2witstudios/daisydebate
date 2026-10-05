import Link from 'next/link';
import { leaderboardDestinations } from '../../features/leaderboard/actions';
import type { DebaterDetail } from '../../features/leaderboard/detail';
import type { LadderView } from '../../features/leaderboard/ladder-view';
import { ladderHref, type LadderQuery } from '../../features/leaderboard/query';
import {
  isClosed,
  seasonCountdown,
  seasonLabel,
} from '../../features/leaderboard/season';
import { DebaterDrawer } from './debater-drawer/debater-drawer';
import { LadderFilters } from './ladder-filters/ladder-filters';
import {
  EarlyBanner,
  FinalBanner,
  JudgeNotice,
  LiveNotice,
  NewSeasonHero,
  PreviousChampion,
} from './ladder-states/ladder-states';
import { LadderTable } from './ladder-table/ladder-table';

export type LeaderboardProps = {
  readonly view: LadderView;
  readonly query: LadderQuery;
  /** ISO timestamp the season's day counts from. */
  readonly now: string;
  /** True while the viewer is assigned to judge a debate. */
  readonly judging: boolean;
  /** The open debater's detail, or null when the detail is closed. */
  readonly detail: DebaterDetail | null;
};

/**
 * The leaderboard: one ladder per season, public to read. Search, filters,
 * season and the open detail all live in the URL.
 */
export function Leaderboard({
  view,
  query,
  now,
  judging,
  detail,
}: LeaderboardProps) {
  const closed = isClosed(view.season);
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            Leaderboard
          </h1>
          <p className="flex items-center gap-2 text-base text-ink-muted">
            {closed ? null : (
              <span
                aria-hidden="true"
                className="size-2 rounded-round bg-online"
              />
            )}
            {closed
              ? `${seasonLabel(view.season)} final standings`
              : `${seasonLabel(view.season)} is live. ${seasonCountdown(view.season, now)}`}
          </p>
        </div>
        <nav
          aria-label="About the ladder"
          className="flex gap-4 text-sm font-strong"
        >
          <Link href={leaderboardDestinations.seasons}>Seasons</Link>
          <Link href={leaderboardDestinations.howRatingWorks}>
            How ratings work
          </Link>
        </nav>
      </header>
      {judging ? <JudgeNotice /> : null}
      {closed ? <FinalBanner season={view.season} /> : null}
      {view.early ? (
        <EarlyBanner
          season={view.season}
          now={now}
          established={view.established}
          provisional={view.provisional}
        />
      ) : null}
      {view.empty === 'new-season' ? (
        <NewSeasonHero season={view.season} now={now} />
      ) : null}
      <LiveNotice
        changes={view.pendingChanges}
        refreshHref={ladderHref(query)}
      />
      <LadderTable
        view={view}
        query={query}
        toolbar={
          <LadderFilters
            query={query}
            seasons={view.seasons}
            season={view.season}
            hasStanding={view.hasStanding}
          />
        }
      />
      {view.empty === 'new-season' && view.previousChampion ? (
        <PreviousChampion champion={view.previousChampion} />
      ) : null}
      <p className="text-sm text-ink-faint">
        <Link href={leaderboardDestinations.privacy}>Ladder privacy</Link>
      </p>
      {detail ? <DebaterDrawer detail={detail} query={query} /> : null}
    </div>
  );
}
