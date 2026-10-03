import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { tournamentRoutes } from './routes';
import type { Structure, Tournament } from './tournament';

export type Slot = { readonly seed: number; readonly handle: string } | null;

export type Match = {
  readonly id: string;
  readonly label: string;
  readonly a: Slot;
  readonly b: Slot;
  readonly state: 'done' | 'live' | 'pending';
  readonly winner: 'a' | 'b' | null;
  readonly judge: string | null;
  readonly watching: number | null;
  /** Sample wording for when a pending match happens. */
  readonly note: string | null;
};

export type EliminationData = {
  readonly kind: 'elimination';
  readonly tournament: Tournament;
  readonly rounds: readonly {
    readonly label: string;
    readonly matches: readonly Match[];
  }[];
  readonly liveLine: string;
  /** UTC ISO timestamp of the last update. */
  readonly updatedAt: string;
};

type RobinTable = {
  readonly table: number;
  readonly a: string;
  readonly b: string;
  readonly winner: 'a' | 'b' | null;
};

export type RobinRound = {
  readonly number: number;
  readonly state: 'done' | 'out' | 'scheduled';
  /** Sample wording: "Pairings out, 16:00". */
  readonly note: string;
  readonly tables: readonly RobinTable[];
};

export type RobinData = {
  readonly kind: 'round-robin';
  readonly tournament: Tournament;
  readonly handles: readonly string[];
  readonly rounds: readonly RobinRound[];
  readonly liveLine: string;
  readonly updatedAt: string;
  /** Sample wording for the next round's time, keyed by round number. */
  readonly times: Readonly<Record<number, string>>;
};

export type BracketData = EliminationData | RobinData;

const eliminationViews = ['bracket', 'rounds'] as const;
const robinViews = ['standings', 'grid', 'rounds'] as const;
export type BracketView =
  (typeof eliminationViews)[number] | (typeof robinViews)[number];

/** The views a structure offers, first being its default. */
export const viewsFor = (structure: Structure): readonly BracketView[] =>
  structure === 'single-elimination' ? eliminationViews : robinViews;

const schema = z.object({ view: z.string().optional().catch(undefined) });

/** Reads `?view=`; a view the structure lacks becomes its default. */
export function parseBracketView(
  params: SearchParams,
  structure: Structure,
): BracketView {
  const value = params['view'];
  const asked = schema.parse({
    view: typeof value === 'string' ? value : value?.[0],
  }).view;
  const views = viewsFor(structure);
  return views.find((view) => view === asked) ?? (views[0] as BracketView);
}

export const bracketHref = (
  id: string,
  view: BracketView,
  structure: Structure,
): string =>
  view === viewsFor(structure)[0]
    ? tournamentRoutes.bracket(id)
    : `${tournamentRoutes.bracket(id)}?view=${view}`;

export type StandingRow = {
  readonly rank: number;
  readonly handle: string;
  readonly won: number;
  readonly lost: number;
  readonly opponentWins: number;
  readonly next: { readonly round: number; readonly opponent: string } | null;
};

const opponentsOf = (round: RobinRound, handle: string) =>
  round.tables.flatMap((table) =>
    table.a === handle ? [table] : table.b === handle ? [table] : [],
  );

const winnerOf = (table: RobinTable): string | null =>
  table.winner === null ? null : table[table.winner];

/**
 * Standings from the played tables: rounds won, then the total wins of the
 * debaters met, then handle. The tiebreak order is a sample; the organizer
 * sets the real one.
 */
export function standings(data: RobinData): readonly StandingRow[] {
  const played = data.rounds.filter((round) => round.state === 'done');
  const won = new Map(data.handles.map((handle) => [handle, 0]));
  const lost = new Map(data.handles.map((handle) => [handle, 0]));
  for (const round of played)
    for (const table of round.tables) {
      const winner = winnerOf(table);
      const loser = winner === table.a ? table.b : table.a;
      if (winner === null) continue;
      won.set(winner, (won.get(winner) ?? 0) + 1);
      lost.set(loser, (lost.get(loser) ?? 0) + 1);
    }
  const rows = data.handles.map((handle) => ({
    handle,
    won: won.get(handle) ?? 0,
    lost: lost.get(handle) ?? 0,
    opponentWins: played
      .flatMap((round) => opponentsOf(round, handle))
      .reduce(
        (sum, table) =>
          sum + (won.get(table.a === handle ? table.b : table.a) ?? 0),
        0,
      ),
  }));
  const upcoming = data.rounds.find((round) => round.state !== 'done');
  return rows
    .sort(
      (x, y) =>
        y.won - x.won ||
        y.opponentWins - x.opponentWins ||
        x.handle.localeCompare(y.handle),
    )
    .map((row, index) => {
      const table = upcoming ? opponentsOf(upcoming, row.handle)[0] : undefined;
      return {
        rank: index + 1,
        ...row,
        next:
          upcoming && table
            ? {
                round: upcoming.number,
                opponent: table.a === row.handle ? table.b : table.a,
              }
            : null,
      };
    });
}

/** A cell of the results grid: a result, a round still to come, or empty. */
export type GridCell =
  | { readonly kind: 'self' | 'none' }
  | { readonly kind: 'won' | 'lost' }
  | { readonly kind: 'round'; readonly number: number };

/** Every handle against every handle: W or L once played, else the round. */
export function resultsGrid(data: RobinData): readonly {
  readonly handle: string;
  readonly cells: readonly GridCell[];
}[] {
  return data.handles.map((row) => ({
    handle: row,
    cells: data.handles.map((column): GridCell => {
      if (row === column) return { kind: 'self' };
      for (const round of data.rounds)
        for (const table of round.tables) {
          const pair = [table.a, table.b];
          if (!pair.includes(row) || !pair.includes(column)) continue;
          const winner = winnerOf(table);
          if (winner === null) return { kind: 'round', number: round.number };
          return { kind: winner === row ? 'won' : 'lost' };
        }
      return { kind: 'none' };
    }),
  }));
}

/** One match and the earlier matches that feed its seats. */
export type TreeNode = {
  readonly match: Match;
  readonly feeders: readonly TreeNode[];
};

type Rounds = EliminationData['rounds'];

/**
 * The bracket as one tree rooted at the final. Match i of a round is fed by
 * matches 2i and 2i + 1 of the round before it (a lone one for a bye). Null
 * when the rounds do not narrow to a single final that way, so a malformed
 * bracket is never drawn as a wrong tree.
 */
export function bracketTree(rounds: Rounds): TreeNode | null {
  const counts = rounds.map((round) => round.matches.length);
  const narrows = (count: number, index: number): boolean =>
    count > 0 &&
    (index === 0 || Math.ceil((counts[index - 1] ?? 0) / 2) === count);
  if (counts.at(-1) !== 1 || !counts.every(narrows)) return null;
  const node = (round: number, index: number): TreeNode => ({
    match: rounds[round]?.matches[index] as Match,
    feeders:
      round === 0
        ? []
        : [index * 2, index * 2 + 1]
            .filter((feeder) => feeder < (counts[round - 1] ?? 0))
            .map((feeder) => node(round - 1, feeder)),
  });
  return node(rounds.length - 1, 0);
}
