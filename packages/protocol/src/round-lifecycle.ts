import type { RoundOutcome } from './primitives';
import type { RoundStatus } from './round';

/**
 * How a Round ended, or that it has not: each status holds only the ending
 * instant and the result it can have. The stored and sent shape is unchanged:
 * the same three keys, with the pairings `rounds_lifecycle_check` enforces.
 */
export type RoundEndState =
  | {
      readonly status: 'opening' | 'active';
      readonly completedAt: null;
      readonly outcome: null;
    }
  | {
      readonly status: 'completed';
      readonly completedAt: string;
      /** Null is a real ending that names no winner (DEC-277). */
      readonly outcome: RoundOutcome | null;
    }
  | {
      readonly status: 'abandoned';
      readonly completedAt: string;
      readonly outcome: null;
    };

/**
 * A Round's lifecycle as stored and sent: its ending, with the start instant
 * its status can have. An opening has not started, an active or completed
 * Round has, and a Round abandoned in its opening never did.
 */
export type RoundLifecycle = RoundEndState &
  (
    | { readonly status: 'opening'; readonly startedAt: null }
    | { readonly status: 'active' | 'completed'; readonly startedAt: string }
    | { readonly status: 'abandoned'; readonly startedAt: string | null }
  );

type EndStateColumns = {
  readonly status: RoundStatus;
  readonly completedAt: string | null;
  readonly outcome: RoundOutcome | null;
};
/** The lifecycle columns before they are known to agree: what a row or a parsed view holds. */
export type RoundLifecycleColumns = EndStateColumns & {
  readonly startedAt: string | null;
};

/** What is wrong with a Round's ending columns for its status, or null. */
const roundEndStateFault = (round: EndStateColumns): string | null => {
  switch (round.status) {
    case 'opening':
    case 'active':
      if (round.completedAt !== null)
        return `A Round that is ${round.status} has not ended`;
      return round.outcome === null
        ? null
        : `A Round that is ${round.status} has no outcome`;
    case 'completed':
      return round.completedAt === null
        ? 'A completed Round holds the instant it ended'
        : null;
    case 'abandoned':
      if (round.completedAt === null)
        return 'An abandoned Round holds the instant it ended';
      return round.outcome === null
        ? null
        : 'An abandoned Round has no outcome';
  }
};

const startFault = (round: RoundLifecycleColumns): string | null => {
  switch (round.status) {
    case 'opening':
      return round.startedAt === null
        ? null
        : 'A Round in its opening has not started';
    case 'active':
    case 'completed':
      return round.startedAt === null
        ? `A Round that is ${round.status} holds the instant it started`
        : null;
    case 'abandoned':
      return null;
  }
};

/** What is wrong with a Round's lifecycle columns for its status, or null. */
export const roundLifecycleFault = (
  round: RoundLifecycleColumns,
): string | null => startFault(round) ?? roundEndStateFault(round);

/** Whether a row's ending columns are one its status can hold. */
export const isRoundEndState = <T extends EndStateColumns>(
  round: T,
): round is T & RoundEndState => roundEndStateFault(round) === null;

/** Whether a row's lifecycle columns are one its status can hold. */
export const isRoundLifecycle = <T extends RoundLifecycleColumns>(
  round: T,
): round is T & RoundLifecycle => roundLifecycleFault(round) === null;
