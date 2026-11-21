import type { CompetitionType } from './round';
import type { RoundEndState } from './round-lifecycle';
import type { AttendanceLedgerFacts } from './attendance';
import type { Ladder } from './ladder';
import type { WinnerOutcome } from './round-outcome';
import type { SeatRef } from './seats';

/**
 * The rating decision contract (ADR 0055, ADR 0058) between `@daisy/db`,
 * which loads facts and writes results, and `@daisy/debate-engine`, which
 * decides. It lives here because the adapter sits below the domain and
 * never imports it, yet both must agree on one shape.
 */

/** A Glicko-2 state on the 1500 scale. */
export type RatingState = {
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
};

/**
 * How a Round's finalization record says it ended: the one derived statement
 * rating and history read. A forfeit outranks any ballot on record.
 */
export type RecordedEnding = 'unrecorded' | 'forfeit' | 'unjudged' | 'judged';

/**
 * What a Round's ending is judged rateable from, on any ladder: how it ended
 * and its attendance ledger. Daisy's ratings and a league's ladder read the
 * same facts, so a Round one refuses the other refuses too.
 */
export type EndingRatingFacts = RoundEndState & {
  readonly ending: RecordedEnding;
  readonly attendance: AttendanceLedgerFacts;
};

/** What eligibility is decided from, as the adapter loads it: the Round's ending and what surrounds it. */
export type RatingEligibilityFacts = EndingRatingFacts & {
  readonly competitionType: CompetitionType;
  /**
   * The Round's frozen ladder (`ladder_id`, `ladder_division`), derived by
   * CHECK; null when the Round never rates.
   */
  readonly ladder: Ladder | null;
  /** Whether the ledger already holds a change for this round. */
  readonly alreadyRated: boolean;
};

/** Why a Round's ending rates on no ladder. */
type EndingUnrated = {
  readonly kind: 'unrated';
  readonly reason:
    | 'abandoned'
    | 'no-result'
    | 'ending-unrecorded'
    | 'check-in-pending'
    | 'unjudged';
};

export type RatingUnrated =
  EndingUnrated | { readonly kind: 'unrated'; readonly reason: 'competition' };

/** Whether a Round's ending rates, apart from which ladder it rates on. */
export type EndingRating =
  | {
      readonly kind: 'rated';
      /** A rating compares two sides: only a two-sided Round's winner is rated. */
      readonly outcome: WinnerOutcome;
      readonly occurredAt: string;
    }
  /** A rating is still owed, but the attendance ledger does not settle yet. */
  | { readonly kind: 'attendance-unsettled' }
  | EndingUnrated;

export type RatingEligibility =
  | {
      readonly kind: 'rated';
      readonly ladder: Ladder;
      /** A rating compares two sides: only a two-sided Round's winner is rated. */
      readonly outcome: WinnerOutcome;
      readonly occurredAt: string;
    }
  | { readonly kind: 'already-rated' }
  /** A rating is still owed, but the attendance ledger does not settle yet. */
  | { readonly kind: 'attendance-unsettled' }
  | RatingUnrated;

/** What the ledger holds for one debater on this ladder. */
export type DebaterStanding = {
  /** This season's row and its version, if any. */
  readonly current: {
    readonly state: RatingState;
    readonly version: number;
  } | null;
  /** The latest earlier season's state, if any. */
  readonly previous: RatingState | null;
  /** The last time this debater was rated on this ladder. */
  readonly lastRatedAt: string | null;
};

/** What a rating plan is computed from, as the adapter loads it. */
export type RatingPlanFacts = {
  readonly ladder: Ladder;
  readonly outcome: WinnerOutcome;
  readonly occurredAt: string;
  readonly seasonId: string | null;
  readonly seats: readonly {
    readonly actorId: string;
    readonly seat: SeatRef;
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
  readonly ladder: Ladder;
  readonly seasonId: string;
  readonly occurredAt: string;
  readonly calculationVersion: string;
  readonly changes: readonly PlannedRatingChange[];
};
