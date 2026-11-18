import type { BracketView } from '@daisy/protocol/lobby/standings-read';
import { collapsed, type Collapsed } from './at-scale';

/** At scale, a table is cut at its break line and a bracket at its live round. */
/** One break line's table: who broke above it, the rows around it, and the rest. */
export type BreakTable<Row> = {
  readonly id: string;
  /** Rows of this ranking that took an earlier line, so are not seeded here. */
  readonly earlier: readonly Row[];
  /** The rows in the break that are clear of the line, collapsed. */
  readonly clear: Collapsed<Row>;
  /** The rows in the break nearest the line, which the tiebreaks decided. */
  readonly near: readonly Row[];
  /** The first rows below the line. */
  readonly below: readonly Row[];
  /** How many rows are below those, and every row of this ranking. */
  readonly more: number;
  readonly total: number;
};

/** One break line: its ranking (the whole table, or a division's), and its size. */
export type BreakLineInput<Row> = {
  readonly id: string;
  readonly seeds: number;
  readonly rows: readonly Row[];
};

/**
 * One table per break line, in order (the main break, then a division's).
 * A row that took an earlier line is set aside, not seeded again. In each,
 * the rows clear of the line (by `clearOf`, against the first row out) are
 * collapsed unless the line is open; the rest of the break sits above the
 * line and `below` rows under it, with the remainder counted.
 */
export function breakTables<Row>(
  lines: readonly BreakLineInput<Row>[],
  options: {
    readonly keyOf: (row: Row) => string;
    readonly clearOf: (row: Row, firstOut: Row) => boolean;
    readonly below: number;
    readonly open: ReadonlySet<string>;
  },
): readonly BreakTable<Row>[] {
  const taken = new Set<string>();
  return lines.map((line) => {
    const earlier = line.rows.filter((row) => taken.has(options.keyOf(row)));
    const ranked = line.rows.filter((row) => !taken.has(options.keyOf(row)));
    const breaking = ranked.slice(0, line.seeds);
    const out = ranked.slice(line.seeds);
    const firstOut = out[0];
    const clearCount =
      firstOut === undefined
        ? breaking.length
        : breaking.filter((row) => options.clearOf(row, firstOut)).length;
    for (const row of breaking) taken.add(options.keyOf(row));
    const below = out.slice(0, options.below);
    return {
      id: line.id,
      earlier,
      clear: collapsed(breaking.slice(0, clearCount), {
        limit: 0,
        open: options.open.has(line.id),
      }),
      near: breaking.slice(clearCount),
      below,
      more: out.length - below.length,
      total: line.rows.length,
    };
  });
}

/**
 * The standings' sense of clear: a win more than the first entry out, or
 * at least `points` more speaker points on the same wins.
 */
export const clearByWinOrPoints =
  (points: number) =>
  (
    row: { readonly wins: number; readonly points: number | null },
    firstOut: { readonly wins: number; readonly points: number | null },
  ): boolean =>
    row.wins > firstOut.wins ||
    (row.wins === firstOut.wins &&
      row.points !== null &&
      firstOut.points !== null &&
      row.points - firstOut.points >= points);

type BracketRound = BracketView['tabRounds'][number];

/** The rounds before the live one, summed up: how many results, and the upsets. */
export type EarlierRounds = {
  readonly names: readonly string[];
  readonly results: number;
  readonly upsets: number;
  /** The upset with the widest gap in seeds: the winner's seed, then the loser's. */
  readonly biggest: readonly [number, number] | null;
};

/** The bracket from its live round onward, with the rounds before it summed up. */
export type BracketFromLive<Round> = {
  readonly earlier: readonly Round[];
  readonly shown: readonly Round[];
  readonly summary: EarlierRounds | null;
};

/**
 * The bracket from the live round onward (or the first not yet run), with
 * at least `keep` rounds shown so a finished bracket keeps its last rounds.
 * The earlier rounds are summed up and shown only when asked for.
 */
export function bracketFromLive<Round extends BracketRound>(
  rounds: readonly Round[],
  options: { readonly keep: number; readonly showEarlier: boolean },
): BracketFromLive<Round> {
  const live = rounds.findIndex((round) => round.status !== 'complete');
  const from = Math.max(
    0,
    Math.min(live === -1 ? rounds.length : live, rounds.length - options.keep),
  );
  const earlier = rounds.slice(0, from);
  if (options.showEarlier || earlier.length === 0)
    return { earlier: [], shown: rounds, summary: null };
  const decided = earlier.flatMap((round) =>
    round.fixtures.filter((fixture) => fixture.state.kind === 'decided'),
  );
  const comparisons = decided.map((fixture) => {
    if (fixture.state.kind !== 'decided') return [];
    const outcomes = fixture.state.outcomes;
    return fixture.entries.flatMap((winner) =>
      fixture.entries.flatMap(
        (loser): readonly (readonly [number, number])[] => {
          if (
            winner.seed === null ||
            loser.seed === null ||
            winner.entryId === loser.entryId
          )
            return [];
          const first = outcomes.find(
            (outcome) => outcome.entryId === winner.entryId,
          );
          const second = outcomes.find(
            (outcome) => outcome.entryId === loser.entryId,
          );
          const ahead =
            (first?.won === true && second?.won === false) ||
            (first?.rank != null &&
              second?.rank != null &&
              first.rank < second.rank);
          return ahead && winner.seed > loser.seed
            ? [[winner.seed, loser.seed]]
            : [];
        },
      ),
    );
  });
  const upsets = comparisons.filter((pairs) => pairs.length > 0);
  const biggest = comparisons
    .flat()
    .reduce<readonly [number, number] | null>(
      (wide, upset) =>
        wide === null || upset[0] - upset[1] > wide[0] - wide[1] ? upset : wide,
      null,
    );
  return {
    earlier,
    shown: rounds.slice(from),
    summary: {
      names: earlier.map((round) => round.name),
      results: decided.length,
      upsets: upsets.length,
      biggest,
    },
  };
}
