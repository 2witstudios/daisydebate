import Link from 'next/link';
import { leaderboardDestinations } from '../../../features/leaderboard/actions';
import {
  isClosed,
  seasonLabel,
  seasonProgress,
  type Season,
} from '../../../features/leaderboard/season';
import { PROVISIONAL_AFTER } from '../../../features/leaderboard/standing';
import { seasonEnds } from '../ladder-states/ladder-states';

export type SeasonCardProps = {
  readonly season: Season;
  readonly now: string;
};

const card = 'flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-1';
const eyebrow = 'text-2xs font-bold tracking-wider text-ink-faint uppercase';

/** "This season" and "How ratings work", above the ladder on wide screens. */
export function SeasonCard({ season, now }: SeasonCardProps) {
  const closed = isClosed(season);
  const { day, length } = seasonProgress(season, now);
  return (
    <aside
      aria-label="Season"
      className="grid grid-cols-2 gap-4 max-compact:hidden"
    >
      <section className={card}>
        <span className={eyebrow}>
          {closed ? 'Closed season' : 'This season'}
        </span>
        <span className="font-display text-xl font-bold">
          {seasonLabel(season)}
        </span>
        <span className="text-sm text-ink-muted">
          {closed ? 'Final standings are frozen.' : seasonEnds(season, now)}
        </span>
        <progress
          value={closed ? length : day}
          max={length}
          aria-label="Season progress"
          className="h-2 w-full accent-accent"
        />
        <Link
          href={leaderboardDestinations.seasons}
          className="text-sm font-strong"
        >
          Seasons and standings
        </Link>
      </section>
      <section className={card}>
        <span className={eyebrow}>How ratings work</span>
        <p className="text-sm text-ink-muted">
          Every ranked debate moves your rating. New debaters are provisional
          until they have played {PROVISIONAL_AFTER} ranked debates.
        </p>
        <Link
          href={leaderboardDestinations.howRatingWorks}
          className="text-sm font-strong"
        >
          Read the explainer
        </Link>
      </section>
    </aside>
  );
}
