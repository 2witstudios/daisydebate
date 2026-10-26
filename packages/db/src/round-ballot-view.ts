import {
  ballotSchema,
  type Ballot,
  type DebateSide,
  type RoundCoaching,
} from '@daisy/protocol';
import type { FrozenRoundTranscript } from './frozen-transcript';
import type { RoundFeedbackFacts } from './round-feedback';
import type { ballots } from './schema/ballots';

type StoredBallot = typeof ballots.$inferSelect;

const ballotBody = (row: StoredBallot) =>
  ballotSchema.parse({
    rubricVersion: row.rubricVersion,
    winner: row.winner,
    scores: row.scores,
    reason: row.reason,
    feedback: row.feedback ?? {},
    ...(row.citations ? { citations: row.citations } : {}),
  });

/** Only a human judge seated in this Round reads its own ballot and the frozen input. */
export const ownJudgeSeat = <
  P extends {
    readonly actorId: string;
    readonly role: string;
    readonly kind: string;
  },
>(
  participants: readonly P[],
  actorId: string,
) =>
  participants.find(
    (p) => p.actorId === actorId && p.role === 'judge' && p.kind === 'human',
  );

/** A ballot's feedback narrowed to the one side this reader debated, if any. */
const feedbackFor = (
  feedback: Ballot['feedback'],
  side: DebateSide | undefined,
): Ballot['feedback'] => {
  const text = side ? feedback[side] : undefined;
  return side && text ? { [side]: text } : {};
};

/**
 * The caller's own ballot, the frozen transcript for their judging seat, and
 * every ballot only once the Round has completed: no judge reads another's
 * ballot while judging is still open. Released ballots say whether a human
 * or the AI judged, never who, and carry only the reader's own side's
 * feedback (ADR 0071).
 */
export function ballotReadView(input: {
  readonly status: string;
  readonly ownSeatId: string | undefined;
  readonly viewerSide: DebateSide | undefined;
  readonly aiJudgeSeatIds: ReadonlySet<string>;
  readonly rows: readonly StoredBallot[];
  readonly frozen: FrozenRoundTranscript | null;
}) {
  const own = input.rows.find((b) => b.judgeParticipantId === input.ownSeatId);
  const { frozen } = input;
  return {
    own: input.ownSeatId
      ? {
          participantId: input.ownSeatId,
          status: own?.status ?? null,
          ballot: own ? ballotBody(own) : null,
          freezeRevision: own?.freezeRevision ?? null,
        }
      : null,
    freeze: frozen
      ? {
          revision: frozen.revision,
          frontier: frozen.frontier,
          frozenAt: frozen.frozenAt,
          completeness: frozen.completeness,
          utterances: frozen.utterances,
        }
      : null,
    ballots:
      input.status === 'completed'
        ? input.rows.map((row) => {
            const ballot = ballotBody(row);
            return {
              status: row.status,
              judge: input.aiJudgeSeatIds.has(row.judgeParticipantId)
                ? ('ai' as const)
                : ('human' as const),
              ballot: {
                ...ballot,
                feedback: feedbackFor(ballot.feedback, input.viewerSide),
              },
            };
          })
        : [],
  };
}

/**
 * A debater's coaching for a completed Round: the AI judge's ballot when it
 * coached their side, else the coaching pass. A Round still eligible for that
 * pass is pending only while coaching runs in this deployment.
 */
export function coachingFor(input: {
  readonly status: string;
  readonly viewerSide: DebateSide | undefined;
  readonly aiJudgeSeatIds: ReadonlySet<string>;
  readonly rows: readonly StoredBallot[];
  readonly facts: RoundFeedbackFacts;
  readonly enabled: boolean;
}): RoundCoaching | null {
  const side = input.viewerSide;
  if (!side || input.status !== 'completed') return null;
  const judged = input.rows.some(
    (row) =>
      row.status === 'submitted' &&
      input.aiJudgeSeatIds.has(row.judgeParticipantId) &&
      Boolean(row.feedback?.[side]),
  );
  if (judged) return { status: 'in-ballot' };
  const { facts } = input;
  const text = facts.feedback?.[side];
  if (facts.status === 'succeeded' && text) return { status: 'ready', text };
  if (facts.status === 'leased') return { status: 'pending' };
  if (facts.status === null && facts.eligible && input.enabled)
    return { status: 'pending' };
  return { status: 'unavailable' };
}
