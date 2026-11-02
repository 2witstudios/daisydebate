import { createInvariantError } from '@daisy/errors';
import type {
  DebateSide,
  RatedOutcome,
  RoundPanelCompletion,
} from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';
import { debateIsOver, type CommandContext } from './round-commands';
import { deriveRoundOutcome, participatingRulings } from './round-outcome';

type Ruling = {
  readonly judgeParticipantId: string;
  readonly winner: DebateSide;
  readonly status: 'submitted' | 'voided';
};
export type PanelDecision =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'complete';
      readonly ruling:
        | 'unjudged'
        | 'judges-did-not-rule'
        | 'transcript-incomplete'
        | 'judging-failed'
        | 'partial';
      readonly outcome: RatedOutcome | null;
      /** Judge seats recorded as giving no ruling. */
      readonly noRuling: readonly string[];
    };

type Completeness = { readonly completeness: 'complete' | 'incomplete' };
/**
 * Who may rule on a frozen transcript (DEC-208). An AI judge never decides from
 * a transcript frozen incomplete, which only a media, capture or speech-to-text
 * gap produces, so no AI judging is dispatched. A ballot deadline exists only
 * for a human judge to rule by: with none, nobody waits on it. An AI seat is
 * bounded by its own budget instead (DEC-275).
 */
export function freezeJudgingPlan(
  input: Completeness & {
    /** Whether any judge seat is a human, who heard the Round live. */
    readonly humanJudges: boolean;
    readonly ballotDeadlineMs: number;
    readonly aiJudgingBudgetMs: number;
  },
) {
  return {
    dispatchAiJudges: input.completeness !== 'incomplete',
    ballotDeadlineMs: input.humanJudges ? input.ballotDeadlineMs : null,
    aiJudgingBudgetMs: input.aiJudgingBudgetMs,
  };
}

/**
 * When a Round without a full set of ballots completes, on every ladder. A
 * zero-judge Round completes at once. Otherwise it waits only on a judge who
 * can still rule: a human seat before the persisted ballot deadline (DEC-201,
 * DEC-207), or an AI seat whose job is still running or holds a validated
 * ballot (DEC-275). A failed AI judge never holds the Round and never blocks a
 * human ballot (DEC-277). Then the submitted ballots decide by the existing
 * rule; with none, or a tie the absent rulings would otherwise turn into a
 * draw, there is no outcome, and the ruling says why.
 */
export function decidePanelCompletion(
  input: PanelFacts & {
    readonly ballots: readonly Ruling[];
    /** NaN when no deadline was persisted: no human judge is waited on. */
    readonly ballotDeadlineAtMs: number;
    readonly nowMs: number;
  },
): PanelDecision {
  if (input.judgeSeatIds.length === 0)
    return {
      kind: 'complete',
      ruling: 'unjudged',
      outcome: null,
      noRuling: [],
    };
  const submitted = participatingRulings(input.judgeSeatIds, input.ballots);
  const ruled = new Set(submitted.map((ballot) => ballot.judgeParticipantId));
  const noRuling = input.judgeSeatIds.filter((id) => !ruled.has(id));
  const humanWindowOpen = input.nowMs < input.ballotDeadlineAtMs;
  const awaiting =
    (humanWindowOpen && input.humanJudgeSeatIds.some((id) => !ruled.has(id))) ||
    input.runningAiSeatIds.some((id) => !ruled.has(id));
  if (noRuling.length === 0 || awaiting) return { kind: 'pending' };
  const outcome = submitted.length
    ? deriveRoundOutcome(
        [...ruled].map((id) => ({ id, role: 'judge' })),
        submitted,
      )
    : null;
  if (outcome !== null && outcome !== 'draw')
    return { kind: 'complete', ruling: 'partial', outcome, noRuling };
  // A tie can still change while the human window is open: a voided seat may rule again.
  if (humanWindowOpen && input.humanJudgeSeatIds.length > 0)
    return { kind: 'pending' };
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
  /** AI seats whose job can still produce or submit a ballot. */
  readonly runningAiSeatIds: readonly string[];
  /** AI seats whose job ended, or ran out of budget, with no ballot. */
  readonly failedAiSeatIds: readonly string[];
};
/** Why a judged Round has no outcome, each with a different meaning for the receipt. */
const noOutcomeRuling = (input: PanelFacts) => {
  if (input.humanJudgeSeatIds.length > 0) return 'judges-did-not-rule' as const;
  if (input.completeness === 'incomplete')
    return 'transcript-incomplete' as const;
  return input.failedAiSeatIds.length > 0
    ? ('judging-failed' as const)
    : ('judges-did-not-rule' as const);
};

const isClosedActiveRound = (
  c: CommandContext,
  judgeSeatIds: readonly string[],
) =>
  c.rules.seats.judge === judgeSeatIds.length &&
  c.on.lifecycle().status === 'active' &&
  c.on.lifecycle().outcome === null &&
  c.on.openRow() === undefined &&
  debateIsOver(c);

/** The caller verifies immutable freeze and settled attendance under the Round lock. */
export function applyPanelCompletion(
  c: CommandContext,
  input: RoundPanelCompletion,
  participants: readonly { readonly id: string; readonly role: string }[],
): void {
  const judgeSeatIds = participants
    .filter((seat) => seat.role === 'judge')
    .map((seat) => seat.id);
  const decision = decidePanelCompletion({
    completeness: input.completeness,
    humanJudgeSeatIds: input.humanJudgeSeatIds,
    runningAiSeatIds: input.runningAiSeatIds,
    failedAiSeatIds: input.failedAiSeatIds,
    judgeSeatIds,
    ballots: input.ballots,
    ballotDeadlineAtMs:
      input.ballotDeadlineAt === null
        ? Number.NaN
        : Date.parse(input.ballotDeadlineAt),
    nowMs: c.now,
  });
  if (
    !isClosedActiveRound(c, judgeSeatIds) ||
    !Number.isFinite(c.now) ||
    decision.kind !== 'complete'
  )
    throw createInvariantError(
      debateInvariantIds.panelPlayedRound,
      'Panel completion requires a closed Round with no judge still able to rule',
    );
  c.assertSeatCompleteness();
  const finalEnd = c.on.rows().at(-1)?.endedAtMs;
  if (finalEnd === undefined || finalEnd === null || c.now < finalEnd)
    throw createInvariantError(
      debateInvariantIds.panelPlayedRound,
      'Panel completion follows the actual final end',
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
