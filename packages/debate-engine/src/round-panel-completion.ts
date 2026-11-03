import { createInvariantError } from '@daisy/errors';
import type {
  DebateSide,
  JudgingPanel,
  JudgingPanelFacts,
  PanelRuling,
  RoundPanelCompletion,
} from '@daisy/protocol';
import { aiSeatStanding } from './judging-job-rules';
import { debateInvariantIds } from './invariant-ids';
import { debateIsOver, type CommandContext } from './round-commands';
import { deriveRoundOutcome, participatingRulings } from './round-outcome';

type Ruling = PanelRuling;
/** Why a panel is still pending. */
export type PanelWait =
  | { readonly on: 'human_window'; readonly deadlineAt: string }
  | { readonly on: 'ai_generating'; readonly deadlineAt: string }
  | { readonly on: 'held_ballot' };
export type PanelDecision =
  | { readonly kind: 'pending'; readonly waiting: PanelWait }
  | {
      readonly kind: 'complete';
      readonly ruling:
        | 'unjudged'
        | 'judges-did-not-rule'
        | 'transcript-incomplete'
        | 'judging-failed'
        | 'partial'
        | 'ruled'
        | 'judges-split';
      readonly outcome: DebateSide | null;
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
 * The panel a frozen Round's facts describe, or null when a human judge sits
 * with no persisted deadline: nobody may treat that as a closed window, as the
 * winnerless completion guard refuses it too. The freeze always persists one.
 */
export function judgingPanelOf(
  facts: JudgingPanelFacts,
  nowMs: number,
): JudgingPanel | null {
  const [firstHuman, ...otherHumans] = facts.humanJudgeSeatIds;
  if (firstHuman !== undefined && facts.ballotDeadlineAt === null) return null;
  return {
    humanWindow:
      firstHuman !== undefined && facts.ballotDeadlineAt !== null
        ? {
            deadlineAt: facts.ballotDeadlineAt,
            seatIds: [firstHuman, ...otherHumans],
          }
        : null,
    aiSeats: facts.aiJudgeSeatIds.map((id) => {
      const job = facts.jobs.find((row) => row.judgeParticipantId === id);
      return {
        id,
        standing: job
          ? aiSeatStanding(job, facts.held, nowMs)
          : { state: 'not_dispatched' as const },
      };
    }),
  };
}

const panelSeatIds = ({ humanWindow, aiSeats }: JudgingPanel) => [
  ...(humanWindow?.seatIds ?? []),
  ...aiSeats.map((seat) => seat.id),
];

/** Which unruled seat holds the Round, in the order the room names them. */
function awaitedSeat(
  panel: JudgingPanel,
  ruled: ReadonlySet<string>,
  humanWindowOpen: boolean,
): PanelWait | null {
  if (
    humanWindowOpen &&
    panel.humanWindow?.seatIds.some((id) => !ruled.has(id))
  )
    return { on: 'human_window', deadlineAt: panel.humanWindow.deadlineAt };
  const unruled = panel.aiSeats
    .filter((seat) => !ruled.has(seat.id))
    .map((seat) => seat.standing);
  const generating = unruled.flatMap((standing) =>
    standing.state === 'generating' ? [standing.deadlineAt] : [],
  );
  if (generating.length > 0)
    return { on: 'ai_generating', deadlineAt: generating.sort().at(-1)! };
  return unruled.some((standing) => standing.state === 'holding_ballot')
    ? { on: 'held_ballot' }
    : null;
}

/**
 * When a Round without a full set of ballots completes, on every ladder. A
 * zero-judge Round completes at once. Otherwise it waits only on a judge who
 * can still rule: a human seat before the persisted ballot deadline (DEC-201,
 * DEC-207), or an AI seat whose job is still running or holds a validated
 * ballot (DEC-275). A failed AI judge never holds the Round and never blocks a
 * human ballot (DEC-277). Then the submitted ballots decide by the existing
 * rule; with none, or a tie, there is no outcome (DEC-277), and the ruling says
 * why. Nobody can rule twice, so a tie with every seat ruled ends at once.
 */
export function decidePanelCompletion(input: {
  readonly completeness: 'complete' | 'incomplete';
  readonly panel: JudgingPanel;
  readonly ballots: readonly Ruling[];
  readonly nowMs: number;
}): PanelDecision {
  const { panel } = input;
  const judgeSeatIds = panelSeatIds(panel);
  if (judgeSeatIds.length === 0)
    return {
      kind: 'complete',
      ruling: 'unjudged',
      outcome: null,
      noRuling: [],
    };
  const submitted = participatingRulings(judgeSeatIds, input.ballots);
  const ruled = new Set(submitted.map((ballot) => ballot.judgeParticipantId));
  const noRuling = judgeSeatIds.filter((id) => !ruled.has(id));
  const window = panel.humanWindow;
  const humanWindowOpen =
    window !== null && input.nowMs < Date.parse(window.deadlineAt);
  const awaited = awaitedSeat(panel, ruled, humanWindowOpen);
  if (awaited) return { kind: 'pending', waiting: awaited };
  const outcome = submitted.length
    ? deriveRoundOutcome(
        [...ruled].map((id) => ({ id, role: 'judge' })),
        submitted,
      )
    : null;
  if (noRuling.length === 0)
    return {
      kind: 'complete',
      ruling: outcome === null ? 'judges-split' : 'ruled',
      outcome,
      noRuling,
    };
  if (outcome !== null)
    return { kind: 'complete', ruling: 'partial', outcome, noRuling };
  return {
    kind: 'complete',
    ruling: noOutcomeRuling({ ...input, ruled }),
    outcome: null,
    noRuling,
  };
}

/** Why a judged Round has no outcome, each with a different meaning for the receipt. */
const noOutcomeRuling = ({
  panel,
  completeness,
  ruled,
}: {
  readonly panel: JudgingPanel;
  readonly completeness: 'complete' | 'incomplete';
  readonly ruled: ReadonlySet<string>;
}) => {
  if (panel.humanWindow !== null)
    return panel.humanWindow.seatIds.every((id) => ruled.has(id))
      ? ('judges-split' as const)
      : ('judges-did-not-rule' as const);
  if (completeness === 'incomplete') return 'transcript-incomplete' as const;
  return panel.aiSeats.some((seat) => seat.standing.state === 'ended')
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
    panel: input.panel,
    ballots: input.ballots,
    nowMs: c.now,
  });
  const panelSeats = new Set(panelSeatIds(input.panel));
  if (
    panelSeats.size !== judgeSeatIds.length ||
    !judgeSeatIds.every((id) => panelSeats.has(id)) ||
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
