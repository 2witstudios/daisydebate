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
      readonly ruling:
        | 'unjudged'
        | 'judges-did-not-rule'
        | 'transcript-incomplete'
        | 'partial';
      readonly outcome: RatedOutcome | null;
      /** Judge seats recorded as giving no ruling. */
      readonly noRuling: readonly string[];
    };

type Completeness = { readonly completeness: 'complete' | 'incomplete' };
/**
 * Who may rule on a frozen transcript (DEC-208). An AI judge never decides from
 * a transcript frozen incomplete, which only a media, capture or speech-to-text
 * gap produces, so no AI judging is dispatched; with no human judge to rule,
 * the ruling window closes at the freeze. Human judges keep the full window.
 */
export function freezeJudgingPlan(
  input: Completeness & {
    /** Whether any judge seat is a human, who heard the Round live. */
    readonly humanJudges: boolean;
    readonly ballotDeadlineMs: number;
  },
) {
  const gated = input.completeness === 'incomplete';
  return {
    dispatchAiJudges: !gated,
    ballotDeadlineMs: gated && !input.humanJudges ? 0 : input.ballotDeadlineMs,
  };
}

/**
 * When a Round without a full set of ballots completes (DEC-201, DEC-207). A
 * zero-judge Round completes at once. A judged Round waits for its ballots,
 * which complete it themselves, until the ballot deadline persisted at the
 * freeze; then missing ballots are no ruling. The submitted ballots decide a
 * winner by the existing rule; with none, or a tie the absent rulings would
 * otherwise turn into a draw, the judges did not rule and there is no outcome.
 * On an incomplete freeze only the human judges can rule (DEC-208): once each
 * has, a decisive result completes without waiting for the AI seats.
 */
export function decideUnjudgedCompletion(
  input: PanelFacts & {
    readonly ballots: readonly Ruling[];
    /** NaN when no deadline was persisted, which never passes. */
    readonly ballotDeadlineAtMs: number;
    readonly nowMs: number;
  },
): UnjudgedDecision {
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
  const pastDeadline = input.nowMs >= input.ballotDeadlineAtMs;
  const awaiting = judgesAbleToRule(input).some((id) => !ruled.has(id));
  if (noRuling.length === 0 || (awaiting && !pastDeadline))
    return { kind: 'pending' };
  const outcome = submitted.length
    ? deriveRoundOutcome(
        [...ruled].map((id) => ({ id, role: 'judge' })),
        submitted,
      )
    : null;
  if (outcome !== null && outcome !== 'draw')
    return { kind: 'complete', ruling: 'partial', outcome, noRuling };
  if (!pastDeadline) return { kind: 'pending' };
  return {
    kind: 'complete',
    ruling: noOutcomeRuling(input),
    outcome: null,
    noRuling,
  };
}

type PanelFacts = Completeness & {
  readonly humanJudgeSeatIds: readonly string[];
  readonly judgeSeatIds: readonly string[];
};
/** On an incomplete freeze only the human judges, who heard the Round live, can rule (DEC-208). */
const judgesAbleToRule = (input: PanelFacts) =>
  input.completeness === 'incomplete'
    ? input.humanJudgeSeatIds
    : input.judgeSeatIds;
/** Why a judged Round past its deadline has no outcome. */
const noOutcomeRuling = (input: PanelFacts) =>
  judgesAbleToRule(input).length === 0
    ? ('transcript-incomplete' as const)
    : ('judges-did-not-rule' as const);

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
    completeness: input.completeness,
    humanJudgeSeatIds: input.humanJudgeSeatIds,
    judgeSeatIds,
    ballots: input.ballots,
    ballotDeadlineAtMs:
      input.ballotDeadlineAt === null
        ? Number.NaN
        : Date.parse(input.ballotDeadlineAt),
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
