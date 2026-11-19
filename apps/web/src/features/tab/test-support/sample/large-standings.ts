import type { StandingsView } from '@daisy/protocol/lobby/standings-read';
import { sampleId } from './fixture';
import {
  largeSchool,
  largeSchoolCount,
  largeSurname,
  spread,
} from './large-names';

/**
 * Autumn Open's varsity table at scale: 200 entries, 140 open and 60
 * novice. The top 64 break to triple octofinals; the next 16 novices break
 * on their own line to novice octofinals.
 */
export const LARGE_ENTRIES = 200;
export const LARGE_MAIN_BREAK = {
  seeds: 64,
  tabRoundName: 'Triple octofinals',
};
export const LARGE_NOVICE_BREAK = {
  seeds: 16,
  tabRoundName: 'Novice octofinals',
};
export const NOVICE = 'Novice';

type Row = Extract<StandingsView, { visibility: 'official' }>['rows'][number];

/** Five novices make the main break; 55 more are below it. */
const madeMainBreak = new Set([44, 50, 55, 59, 62]);
export const isLargeNovice = (n: number): boolean =>
  madeMainBreak.has(n) || (n >= 64 && (n - 64) % 5 < 2);

/** Wins and speaker points by place: the top 58 are a win clear of the line. */
const recordAt = (n: number): { wins: number; points: number } => {
  if (n < 20) return { wins: 6, points: 176 - n * 0.25 };
  if (n < 58) return { wins: 5, points: 174 - (n - 20) * 0.1 };
  if (n < 120)
    return { wins: 4, points: 171.5 - Math.floor((n - 57) / 2) * 0.5 };
  if (n < 170) return { wins: 3, points: 168 - (n - 120) * 0.1 };
  return { wins: 2, points: 163 - (n - 170) * 0.1 };
};

const rounded = (points: number) => Math.round(points * 10) / 10;

const rowAt = (n: number, seed: number, above: string | null): Row => {
  const entry = largeSurname(n);
  const { wins, points } = recordAt(n);
  const lastIn = seed === LARGE_MAIN_BREAK.seeds;
  return {
    seed,
    entry: {
      entryId: sampleId(`entry${entry}`),
      shown: { kind: 'name', name: entry },
    },
    responsible: {
      kind: 'school',
      name: largeSchool(spread(n, largeSchoolCount)),
    },
    wins,
    points: rounded(points),
    opponentWins: 8 + spread(n, 9),
    rating: n % 7 === 6 ? null : 1720 - n * 2,
    explanation:
      above === null
        ? `Most wins and speaker points`
        : lastIn
          ? `Tied with ${largeSurname(n + 1)} on everything else; ahead on rating`
          : `Behind ${above} on speaker points`,
    decidesBreak: lastIn,
  };
};

const allRows = (): readonly Row[] =>
  Array.from({ length: LARGE_ENTRIES }, (_, n) =>
    rowAt(n, n + 1, n === 0 ? null : largeSurname(n - 1)),
  );

/** The whole table, grown from the ordinary read's shape. */
export function largeStandingsView(ordinary: StandingsView): StandingsView {
  const rows = allRows();
  const shape = {
    ...ordinary,
    entryCount: LARGE_ENTRIES,
    breakLine: { ...LARGE_MAIN_BREAK },
  };
  return shape.visibility === 'released_decisions'
    ? {
        ...shape,
        rows: rows.map(({ points: _points, ...row }) => row),
      }
    : { ...shape, rows: [...rows] };
}

/** The novice division's own table: its 60 entries in order, seeded 1 to 60. */
export function largeNoviceStandingsView(
  ordinary: StandingsView,
): StandingsView {
  const novices = Array.from({ length: LARGE_ENTRIES }, (_, n) => n).filter(
    isLargeNovice,
  );
  const rows = novices
    .map((n, place) =>
      rowAt(
        n,
        place + 1,
        place === 0 ? null : largeSurname(novices[place - 1] ?? 0),
      ),
    )
    .map((row) => ({ ...row, decidesBreak: false }));
  const shape = {
    ...ordinary,
    division: NOVICE,
    entryCount: novices.length,
    breakLine: { ...LARGE_NOVICE_BREAK },
  };
  return shape.visibility === 'released_decisions'
    ? { ...shape, rows: rows.map(({ points: _points, ...row }) => row) }
    : { ...shape, rows };
}
