import { bloomLabel } from './bloom';
import {
  chartGeometry,
  lastStep,
  peakRating,
  readoutAt,
  resultRows,
  type ChartGeometry,
  type Readout,
  type ResultRow,
} from './history';
import type { LadderViewer } from './ladder-view';
import type { HistoryView, LadderQuery } from './query';
import type { DebaterRead } from './read-leaderboard';
import { seasonLabel, type Season } from './season';
import { PROVISIONAL_AFTER, regionLabel, type RankedEntry } from './standing';

type SeasonPlayedRow = {
  readonly label: string;
  readonly rating: string;
  readonly rank: string;
  readonly record: string;
  readonly current: boolean;
};

type DetailHead = {
  readonly username: string;
  readonly me: boolean;
  /** "Season 4", with the region after it when the debater shows one. */
  readonly subtitle: string;
};

export type DebaterDetail =
  | (DetailHead & { readonly kind: 'hidden' })
  | (DetailHead & { readonly kind: 'none'; readonly text: string })
  | (DetailHead & {
      readonly kind: 'player';
      readonly rating: number;
      /** The 95% range, as "±N". */
      readonly range: string;
      readonly rank: string;
      readonly band: string;
      readonly record: string;
      readonly peak: number;
      readonly established: boolean;
      readonly statusNote: string;
      readonly view: HistoryView;
      readonly chart: ChartGeometry;
      readonly chartLabel: string;
      readonly step: number;
      readonly lastStep: number;
      /** The chart's readout at every step, so a script can scrub it. */
      readonly readouts: readonly Readout[];
      readonly results: readonly ResultRow[];
      readonly recent: readonly ResultRow[];
      readonly seasons: readonly SeasonPlayedRow[];
      readonly profileHref: string;
    });

const record = (entry: RankedEntry): string => `${entry.wins}–${entry.losses}`;

const seasonRow = (
  played: DebaterRead['seasonsPlayed'][number],
  current: Season,
): SeasonPlayedRow => ({
  label: seasonLabel(played.season),
  rating: played.entry
    ? `${played.entry.rating}${played.entry.provisional ? '?' : ''}`
    : '–',
  rank: played.entry
    ? played.entry.provisional
      ? 'Provisional'
      : `#${played.entry.rank}`
    : 'Did not play',
  record: played.entry ? record(played.entry) : '–',
  current: played.season.id === current.id,
});

const headOf = (
  username: string,
  season: Season,
  entry: RankedEntry | null,
  viewer: LadderViewer | null,
): DetailHead => ({
  username,
  me: viewer?.username === username,
  subtitle: [
    seasonLabel(season),
    entry?.region ? regionLabel(entry.region) : null,
  ]
    .filter(Boolean)
    .join(' · '),
});

const statusNoteFor = (entry: RankedEntry): string =>
  entry.provisional
    ? `${entry.played} of ${PROVISIONAL_AFTER} ranked debates. Unranked until ${PROVISIONAL_AFTER}.`
    : 'Rating range is narrow enough to rank.';

/** The stats, chart and lists of a debater who played the season. */
function playerDetail(
  head: DetailHead,
  entry: RankedEntry,
  season: Season,
  read: DebaterRead,
  query: Pick<LadderQuery, 'view' | 'step'>,
): DebaterDetail {
  const established = !entry.provisional;
  const last = lastStep(read.points);
  const results = resultRows(read.points);
  return {
    ...head,
    kind: 'player',
    rating: entry.rating,
    range: `±${2 * entry.deviation}`,
    rank: established ? `#${entry.rank}` : 'Unranked',
    band: bloomLabel(entry.bloom),
    record: record(entry),
    peak: peakRating(read.points),
    established,
    statusNote: statusNoteFor(entry),
    view: query.view,
    chart: chartGeometry(read.points, established ? PROVISIONAL_AFTER : null),
    chartLabel: `Rating history, ${seasonLabel(season)}. Started at ${read.points[0]?.rating}, now ${entry.rating} after ${entry.played} ranked debates.`,
    step: Math.min(last, query.step ?? last),
    lastStep: last,
    readouts: read.points.map((_, at) => readoutAt(read.points, at)),
    results,
    recent: results.slice(0, 5),
    seasons: read.seasonsPlayed.map((played) => seasonRow(played, season)),
    profileHref: `/profile/${head.username}`,
  };
}

/**
 * The detail for one debater in one season. A debater the viewer is judging
 * is never resolved: their rating stays out of the page until the ballot is
 * in, so the drawer says so and nothing more.
 */
export function buildDetail(
  username: string,
  season: Season,
  read: DebaterRead,
  query: Pick<LadderQuery, 'view' | 'step'>,
  viewer: LadderViewer | null,
): DebaterDetail {
  const entry =
    read.seasonsPlayed.find((played) => played.season.id === season.id)
      ?.entry ?? null;
  const head = headOf(username, season, entry, viewer);
  if (viewer?.blinded.includes(username)) return { ...head, kind: 'hidden' };
  if (!entry || read.points.length === 0)
    return {
      ...head,
      kind: 'none',
      text: `${head.me ? 'You have' : `@${username} has`} no ranked debates in ${seasonLabel(season)}.`,
    };
  return playerDetail(head, entry, season, read, query);
}
