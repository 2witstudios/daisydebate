import type { SearchParams } from '../access/decision';
import { ladderLabels } from '../ratings/ladder-labels';
import { rankRatingEntries } from '../ratings/rank';
import { boardLadder } from './board-ladder';
import { toRow } from './ladder-rows';
import type { LadderData, LadderRow, LadderViewer } from './ladder-view';
import { defaultQuery, ladderHref } from './query';
import {
  isClosed,
  seasonDates,
  seasonLabel,
  seasonProgress,
  type Season,
} from './season';

/** The Seasons page reads one URL parameter: which season to show. */
export function parseSeasonsQuery(params: SearchParams): string | null {
  const raw = params['season'];
  const value = typeof raw === 'string' ? raw : raw?.[0];
  return value !== undefined && /^[a-z0-9]{24}$/.test(value) ? value : null;
}

export const seasonsHref = (season: string | null): string =>
  season === null
    ? '/leaderboard/seasons'
    : `/leaderboard/seasons?${new URLSearchParams({ season })}`;

/** Rows in a season's snapshot. */
const SNAPSHOT_SIZE = 10;

/**
 * `running`: the season shown is active. `past`: a closed one, picked while
 * another runs. `none-active`: every season is closed, and this is a closed one.
 */
export type SeasonViewState = 'running' | 'past' | 'none-active';

export type SeasonsView = {
  readonly season: Season;
  readonly ladderLabel: string;
  readonly label: string;
  readonly state: SeasonViewState;
  readonly tag: string;
  readonly dates: string;
  readonly statusLine: string;
  readonly percent: number;
  readonly chips: readonly {
    readonly label: string;
    readonly href: string;
    readonly selected: boolean;
  }[];
  readonly championLabel: string;
  /** The leader: the season's champion once it closes. */
  readonly champion: LadderRow | null;
  readonly snapshotTitle: string;
  readonly snapshot: readonly LadderRow[];
  readonly ladderHref: string;
};

/** A season's overview, its champion and top ten, from its ladder entries. */
export function buildSeasonsView(
  data: LadderData,
  now: string,
  viewer: LadderViewer | null = null,
): SeasonsView {
  const { season } = data;
  const closed = isClosed(season);
  const query = { ...defaultQuery, season: season.id };
  const context = { season, query, viewer, mine: undefined };
  const top = rankRatingEntries(data.entries)
    .filter((entry) => !entry.provisional)
    .slice(0, SNAPSHOT_SIZE)
    .map((entry) => toRow(entry, context));
  const { day, length, percent } = seasonProgress(season, now);
  return {
    season,
    ladderLabel: ladderLabels[boardLadder],
    label: seasonLabel(season),
    state: !closed
      ? 'running'
      : data.seasons.every(isClosed)
        ? 'none-active'
        : 'past',
    tag: closed ? 'Closed' : 'Current season',
    dates: seasonDates(season),
    statusLine: closed
      ? 'Final standings'
      : season.endsAt === null
        ? `Day ${day}`
        : `Day ${day} of ${length}`,
    percent: closed ? 100 : percent,
    chips: data.seasons.map((item) => ({
      label: `${seasonLabel(item)}${isClosed(item) ? '' : ' · current'}`,
      href: seasonsHref(item.id),
      selected: item.id === season.id,
    })),
    championLabel: closed ? 'Champion' : 'Leading now',
    champion: top[0] ?? null,
    snapshotTitle: closed ? 'Final standings' : 'Standings now',
    snapshot: top,
    ladderHref: ladderHref(query),
  };
}
