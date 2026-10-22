import { createInvariantError } from '@daisy/errors';
import type {
  DebateSide,
  RatedOutcome,
  RoundUnjudgedCompletion,
} from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';
import type { CommandContext } from './round-commands';
import { deriveRoundOutcome } from './round-outcome';

type Ruling = {
  readonly judgeParticipantId: string;
  readonly winner: DebateSide;
  readonly status: 'submitted' | 'voided';
};
export type UnjudgedDecision =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'complete';
      readonly ruling: 'unjudged' | 'judges-did-not-rule' | 'partial';
      readonly outcome: RatedOutcome | null;
      /** Judge seats recorded as giving no ruling. */
      readonly noRuling: readonly string[];
    };

/**
 * When a Round without a full set of ballots completes (DEC-201). A zero-judge
 * Round completes at once. A judged Round waits for its ballots, which
 * complete it themselves, until the ballot deadline after the immutable
 * freeze; then missing ballots are no ruling and the outcome comes from the
 * submitted ones by the existing rule, or is null when there are none.
 */
export function decideUnjudgedCompletion(input: {
  readonly judgeSeatIds: readonly string[];
  readonly ballots: readonly Ruling[];
  readonly frozenAtMs: number;
  readonly ballotDeadlineMs: number;
  readonly nowMs: number;
}): UnjudgedDecision {
  if (input.judgeSeatIds.length === 0)
    return {
      kind: 'complete',
      ruling: 'unjudged',
      outcome: null,
      noRuling: [],
    };
  const submitted = input.ballots.filter(
    (ballot) =>
      ballot.status === 'submitted' &&
      input.judgeSeatIds.includes(ballot.judgeParticipantId),
  );
  const ruled = new Set(submitted.map((ballot) => ballot.judgeParticipantId));
  const noRuling = input.judgeSeatIds.filter((id) => !ruled.has(id));
  if (
    noRuling.length === 0 ||
    !(input.nowMs >= input.frozenAtMs + input.ballotDeadlineMs)
  )
    return { kind: 'pending' };
  if (submitted.length === 0)
    return {
      kind: 'complete',
      ruling: 'judges-did-not-rule',
      outcome: null,
      noRuling,
    };
  return {
    kind: 'complete',
    ruling: 'partial',
    outcome: deriveRoundOutcome(
      [...ruled].map((id) => ({ id, role: 'judge' })),
      submitted,
    ),
    noRuling,
  };
}

const isClosedActiveRound = (
  c: CommandContext,
  judgeSeatIds: readonly string[],
) =>
  c.rules.seats.judge === judgeSeatIds.length &&
  c.on.lifecycle().status === 'active' &&
  c.on.lifecycle().outcome === null &&
  c.on.openRow() === undefined &&
  c.closedCount() === c.rules.segments.length;

/** The caller verifies immutable freeze and settled attendance under the Round lock. */
export function applyUnjudgedCompletion(
  c: CommandContext,
  input: RoundUnjudgedCompletion,
  participants: readonly { readonly id: string; readonly role: string }[],
): void {
  const judgeSeatIds = participants
    .filter((seat) => seat.role === 'judge')
    .map((seat) => seat.id);
  const decision = decideUnjudgedCompletion({
    judgeSeatIds,
    ballots: input.ballots,
    frozenAtMs: Date.parse(input.frozenAt),
    ballotDeadlineMs: input.ballotDeadlineMs,
    nowMs: c.now,
  });
  if (
    input.competitionType !== 'casual' ||
    !isClosedActiveRound(c, judgeSeatIds) ||
    !Number.isFinite(c.now) ||
    decision.kind !== 'complete'
  )
    throw createInvariantError(
      debateInvariantIds.unjudgedCasualOnly,
      'Unjudged completion requires a closed casual Round with no judges or a passed ballot deadline',
    );
  c.assertSeatCompleteness();
  const finalEnd = c.on.rows().at(-1)?.endedAtMs;
  if (finalEnd === undefined || finalEnd === null || c.now < finalEnd)
    throw createInvariantError(
      debateInvariantIds.unjudgedCasualOnly,
      'Unjudged completion follows the actual final end',
    );
  c.on.endPrep();
  c.on.setLifecycle({
    status: 'completed',
    outcome: decision.outcome,
    completedAtMs: c.now,
  });
  c.into.effects.push({
    kind: 'round_completed',
    outcome: decision.outcome,
    at: new Date(c.now).toISOString(),
  });
}
