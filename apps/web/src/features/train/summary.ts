/**
 * What the Train hub knows about one account: a read model for the hub and
 * its side column, not stored entities. The backend read that summarises an
 * account's training replaces the seam in `get-summary.ts` and nothing else.
 */

export type StructurePart = 'claim' | 'warrant' | 'responding' | 'impact';

/** A part the account's recent drills most often left out or left unclear. */
export type WeakSpot = {
  readonly part: StructurePart;
  readonly missing: number;
  readonly of: number;
};

type RuleSetEntry = {
  readonly id: string;
  readonly name: string;
};

export type TrainingSummary = {
  /** Sessions ever completed; zero means the account has not trained yet. */
  readonly sessions: number;
  readonly week: {
    /** Monday first: whether the account trained on each day of this week. */
    readonly days: readonly boolean[];
    readonly goal: number;
    readonly practicedDaysLast30: number;
  };
  readonly saved: {
    readonly total: number;
    readonly due: number;
    readonly dueTomorrow: number;
  };
  readonly weakSpot: WeakSpot | null;
  /** Null until the account has had a few drills checked. */
  readonly structure: {
    /** Percent of arguments complete on the first check, oldest week first. */
    readonly trend: readonly number[];
    readonly parts: Readonly<Record<StructurePart, number>>;
  } | null;
  readonly ruleSets: readonly RuleSetEntry[];
};

/** The account that has never trained. */
export const emptySummary: TrainingSummary = {
  sessions: 0,
  week: {
    days: [false, false, false, false, false, false, false],
    goal: 0,
    practicedDaysLast30: 0,
  },
  saved: { total: 0, due: 0, dueTomorrow: 0 },
  weakSpot: null,
  structure: null,
  ruleSets: [],
};

export const isFirstVisit = (summary: TrainingSummary): boolean =>
  summary.sessions === 0;

export const weekSessions = (summary: TrainingSummary): number =>
  summary.week.days.filter(Boolean).length;

export const weekGoalMet = (summary: TrainingSummary): boolean =>
  summary.week.goal > 0 && weekSessions(summary) >= summary.week.goal;
