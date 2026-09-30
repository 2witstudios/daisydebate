import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { formatLongDate } from './dates';
import { structureLabel } from './labels';
import { tournamentRoutes } from './routes';
import type { Tournament } from './tournament';

export const resultsTabs = ['standings', 'rounds', 'honours', 'mine'] as const;
export type ResultsTab = (typeof resultsTabs)[number];

export type ResultsQuery = {
  readonly tab: ResultsTab;
  /** Standings tab: list every entrant, not only the top eight. */
  readonly all: boolean;
};

export const defaultResultsQuery: ResultsQuery = {
  tab: 'standings',
  all: false,
};

const schema = z.object({
  tab: z.enum(resultsTabs).catch(defaultResultsQuery.tab),
  all: z
    .string()
    .transform((value) => value === '1')
    .catch(false),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the results URL; "mine" falls back when the viewer has no result. */
export function parseResultsQuery(
  params: SearchParams,
  hasMine: boolean,
): ResultsQuery {
  const query = schema.parse({
    tab: first(params['tab']),
    all: first(params['all']),
  });
  return query.tab === 'mine' && !hasMine
    ? { ...query, tab: defaultResultsQuery.tab }
    : query;
}

export function resultsHref(id: string, query: ResultsQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== defaultResultsQuery.tab) params.set('tab', query.tab);
  if (query.all) params.set('all', '1');
  const search = params.toString();
  const base = tournamentRoutes.results(id);
  return search === '' ? base : `${base}?${search}`;
}

export type StandingLine = {
  readonly place: string;
  readonly handle: string;
  readonly seed: number;
  readonly rating: number;
  readonly record: string;
  readonly honour: string | null;
};

export type LastRound = {
  readonly label: string;
  readonly winner: string;
  readonly loser: string;
  readonly judge: string;
};

export type Honour = {
  readonly title: string;
  readonly who: string;
  readonly text: string;
};

export type MyRound = {
  readonly label: string;
  readonly opponent: string;
  readonly result: 'Won' | 'Lost';
};

export type Certificate = {
  readonly id: string;
  readonly recipient: string;
  /** "placed second as runner-up". */
  readonly placing: string;
  readonly organizer: string;
};

export type MyResult = {
  readonly honour: string;
  readonly headline: string;
  readonly summary: string;
  readonly rounds: readonly MyRound[];
  readonly certificate: Certificate;
};

export type ResultsData = {
  readonly tournament: Tournament;
  /** UTC ISO timestamp. */
  readonly publishedAt: string;
  readonly standings: readonly StandingLine[];
  readonly lastRounds: readonly LastRound[];
  readonly honours: readonly Honour[];
  readonly mine: MyResult | null;
};

/** The body text of a certificate, from the tournament and the placing. */
export function certificateText(
  tournament: Tournament,
  certificate: Certificate,
): string {
  const kind = structureLabel(tournament.structure)
    .toLowerCase()
    .replace(' ', '-');
  return `${certificate.placing} in the ${tournament.name}, a ${kind} tournament of ${tournament.entered} entrants held on ${formatLongDate(tournament.startsAt)}. This tournament was unrated.`;
}
