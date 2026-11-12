import type { RoundStatus } from './round';

/**
 * The post-round call: after a completed casual Round whose host chose it, the
 * call stays open so the people in it can talk. Never captured (ADR 0126).
 * Its bound is its own: equal to the media window's today, a different concept.
 */
export const postRoundCallPolicy = {
  /** How long after the Round completed the call may stay open. */
  maxMs: 30 * 60_000,
  /** How long the call's room may stand empty before the call is over. */
  vacantGraceMs: 60_000,
  /** A call is a conversation: it needs at least this many human seats. */
  minHumanSeats: 2,
} as const;

/** What decides the call, read from the Round and its media session. */
export type PostRoundCallFacts = {
  /** The host's choice, frozen onto the Round at Start round. */
  readonly optedIn: boolean;
  readonly status: RoundStatus;
  /** When the Round reached its terminal status, or null while it runs. */
  readonly roundEndedAt: string | null;
  /** When the session took the call's own room, or null before it has. */
  readonly openedAt: string | null;
  /** Since when the call's room has stood empty, or null while occupied. */
  readonly vacantSince: string | null;
};

/** Where the call is. `opening` waits for the Round's room to be proven gone. */
export type PostRoundCallState =
  | { readonly kind: 'none' }
  | { readonly kind: 'opening'; readonly endsAtMs: number }
  | { readonly kind: 'open'; readonly endsAtMs: number }
  | { readonly kind: 'over' };

/** A Round with no call: every fact absent. */
export const noPostRoundCall = (status: RoundStatus): PostRoundCallFacts => ({
  optedIn: false,
  status,
  roundEndedAt: null,
  openedAt: null,
  vacantSince: null,
});

/**
 * Whether a Room's choice survives onto its Round: a call is a conversation,
 * so a Round with one human in it has none.
 */
export const freezePostRoundCall = (
  chosen: boolean,
  seats: readonly { readonly kind: string }[],
) =>
  chosen &&
  seats.filter((seat) => seat.kind === 'human').length >=
    postRoundCallPolicy.minHumanSeats;

/** What decides whether a Round's media is open, read at one instant. */
export type MediaWindowFacts = {
  readonly status: RoundStatus;
  readonly now: string;
  readonly finalSegmentEndedAt: string | null;
  readonly postRoundCall: PostRoundCallFacts;
};

/**
 * Where a Round's media stands: the Round's own call, the post-round call
 * waiting for the Round's room to be proven gone, that call, or closed.
 */
export type MediaPhase =
  'round' | 'post-round-call-opening' | 'post-round-call' | 'closed';
