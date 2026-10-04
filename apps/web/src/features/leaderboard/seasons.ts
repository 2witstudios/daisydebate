import type { SearchParams } from '../access/decision';
import { rankEntries } from './standing';
import { toRow } from './ladder-rows';
import type { LadderData, LadderRow } from './ladder-view';
import { defaultQuery } from './query';
import {
  isClosed,
  seasonDates,
  seasonLabel,
  seasonProgress,
  type Season,
} from './season';

/** The Seasons page reads one URL parameter: which season to show. */
export function parseSeasonsQuery(params: SearchParams): number | null {
  const raw = params['season'];
  const value = typeof raw === 'string' ? raw : raw?.[0];
  return value !== undefined && /^\d{1,6}$/.test(value) ? Number(value) : null;
}

export const seasonsHref = (season: number | null): string =>
  season === null
    ? '/leaderboard/seasons'
    : `/leaderboard/seasons?season=${season}`;

/** Rows in a season's snapshot. */
const SNAPSHOT_SIZE = 10;

export type SeasonsView = {
  readonly season: Season;
  readonly label: string;
  readonly closed: boolean;
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
export function buildSeasonsView(data: LadderData, now: string): SeasonsView {
  const { season } = data;
  const closed = isClosed(season);
  const query = { ...defaultQuery, season: season.id };
  const context = { season, query, viewer: null, mine: undefined };
  const top = rankEntries(data.entries)
    .filter((entry) => !entry.provisional)
    .slice(0, SNAPSHOT_SIZE)
    .map((entry) => toRow(entry, context));
  const { day, length, percent } = seasonProgress(season, now);
  return {
    season,
    label: seasonLabel(season),
    closed,
    tag: closed ? 'Closed' : 'Current season',
    dates: seasonDates(season),
    statusLine: closed ? 'Final standings' : `Day ${day} of ${length}`,
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
    ladderHref: `/leaderboard?season=${season.id}`,
  };
}
