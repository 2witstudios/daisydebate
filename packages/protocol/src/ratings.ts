import type { DebatePhase, FormatRules } from './index';
import type { DebateMode, DebateRole, RatingLadder } from './primitives';

/**
 * The rating decision contract (ADR 0055) between `@daisy/db`, which loads
 * facts and writes results, and `@daisy/debate-engine`, which decides. It
 * lives here because the adapter sits below the domain and never imports
 * it, yet both must agree on one shape.
 */

/** A Glicko-2 state on the 1500 scale. */
export type RatingState = {
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
};

export type RatedOutcome = 'affirmative' | 'negative' | 'draw';

/** What eligibility is decided from, as the adapter loads it. */
export type RatingEligibilityFacts = {
  readonly mode: DebateMode;
  readonly phase: DebatePhase;
  readonly outcome: RatedOutcome | 'abandoned' | null;
  readonly completedAt: string | null;
  /** The rules the debate ran under, from its snapshot. */
  readonly rules: FormatRules;
  readonly format: {
    readonly rules: FormatRules;
    readonly rankedEligible: boolean;
  };
  /** Whether the ledger already holds a change for this debate. */
  readonly alreadyRated: boolean;
};

export type RatingUnrated = {
  readonly kind: 'unrated';
  readonly reason: 'mode' | 'abandoned' | 'rules';
};

export type RatingEligibility =
  | {
      readonly kind: 'rated';
      readonly ladder: RatingLadder;
      readonly outcome: RatedOutcome;
      readonly occurredAt: string;
    }
  | { readonly kind: 'already-rated' }
  | RatingUnrated;

/** What the ledger holds for one debater on this format and ladder. */
export type DebaterStanding = {
  /** This season's row and its version, if any. */
  readonly current: {
    readonly state: RatingState;
    readonly version: number;
  } | null;
  /** The latest earlier season's state, if any. */
  readonly previous: RatingState | null;
  /** The last time this debater was rated on this format and ladder. */
  readonly lastRatedAt: string | null;
};

/** What a rating plan is computed from, as the adapter loads it. */
export type RatingPlanFacts = {
  readonly ladder: RatingLadder;
  readonly outcome: RatedOutcome;
  readonly occurredAt: string;
  readonly seasonId: string | null;
  readonly seats: readonly {
    readonly actorId: string;
    readonly role: DebateRole;
  }[];
  readonly standings: Readonly<Record<string, DebaterStanding>>;
  /** cuid2 ids for the two ledger rows, affirmative first. */
  readonly changeIds: readonly [string, string];
};

export type PlannedRatingChange = {
  readonly changeId: string;
  readonly actorId: string;
  readonly before: RatingState;
  readonly after: RatingState;
  /** The `ratings` version to update, or null to insert a new row. */
  readonly expectedVersion: number | null;
};

export type RatingPlan = {
  readonly ladder: RatingLadder;
  readonly seasonId: string;
  readonly occurredAt: string;
  readonly calculationVersion: string;
  readonly changes: readonly PlannedRatingChange[];
};
