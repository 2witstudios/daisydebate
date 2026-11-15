import {
  isJudgeSeat,
  storedBallotSchemaFor,
  ballotSchemaFor,
  ballotDefinitionIdentity,
  type BallotDefinitionSource,
  type Ballot,
  type BallotDefinition,
  type BallotSubjects,
  type SeatRef,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { FrozenRoundTranscript } from './frozen-transcript';
import type { ballots } from './schema/ballots';

type BallotRow = typeof ballots.$inferSelect;

/**
 * A stored ballot as the protocol Ballot, from its columns: a win names its
 * side, and the decision is spelled only where the definition admits more
 * than a win; a ranking carries its places.
 */
export const ballotOfRow = (
  row: BallotRow,
  definition: BallotDefinition,
): Ballot => {
  const spellsDecision =
    definition.decision.kind === 'winner' &&
    (definition.decision.tie || definition.decision.doubleLoss);
  return {
    rubricVersion: row.rubricVersion,
    ...(row.decision === 'ranking'
      ? { ranking: row.ranking ?? [] }
      : {
          ...(spellsDecision ? { decision: row.decision } : {}),
          winner: row.winner,
        }),
    ...(row.scores ? { scores: row.scores } : {}),
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(definition.written.feedback ? { feedback: row.feedback ?? {} } : {}),
    ...(row.speakerRanks ? { speakerRanks: row.speakerRanks } : {}),
    ...(row.citations ? { citations: row.citations } : {}),
  } as Ballot;
};

/** A stored ballot on the definition revision it was written on. */
const ballotBody = (
  row: BallotRow,
  definition: BallotDefinition,
  source: BallotDefinitionSource,
  subjects: BallotSubjects,
): Ballot => {
  if (source.kind === 'stored') {
    if (
      row.ballotDefinitionId !== source.id ||
      row.ballotDefinitionVersion !== source.version ||
      row.rubricVersion !== ballotDefinitionIdentity(definition)
    )
      throw createAppError(
        'INVARIANT',
        'Stored ballot differs from its frozen source',
      );
    return ballotSchemaFor(definition, subjects).parse(
      ballotOfRow(row, definition),
    ) as Ballot;
  }
  if (row.ballotDefinitionId !== null || row.ballotDefinitionVersion !== null)
    throw createAppError(
      'INVARIANT',
      'Daisy ballot has a foreign stored source',
    );
  return storedBallotSchemaFor(definition, subjects).parse(
    ballotOfRow(row, definition),
  ) as Ballot;
};

/** Only a human judge seated in this Round reads its own ballot and the frozen input. */
export const ownJudgeSeat = <
  P extends {
    readonly actorId: string;
    readonly seat: SeatRef;
    readonly kind: string;
  },
>(
  participants: readonly P[],
  actorId: string,
) =>
  participants.find(
    (p) => p.actorId === actorId && isJudgeSeat(p.seat) && p.kind === 'human',
  );

/**
 * A ballot's feedback narrowed to the one subject this reader is (their side,
 * or themselves when the ballot ranks speakers), if any.
 */
const feedbackFor = (
  feedback: Ballot['feedback'],
  subject: string | undefined,
): NonNullable<Ballot['feedback']> => {
  const text = subject ? feedback?.[subject] : undefined;
  return subject && text ? { [subject]: text } : {};
};

/**
 * The caller's own ballot, the frozen transcript for their judging seat, and
 * every ballot only once the Round has completed: no judge reads another's
 * ballot while judging is still open. Released ballots say whether a human or
 * the AI judged, never who, and carry only the reader's own feedback
 * (ADR 0071).
 */
export function ballotReadView(input: {
  readonly status: string;
  readonly ownSeatId: string | undefined;
  /** The subject the reader's feedback is written under (`feedbackSubjectOf`). */
  readonly viewerSubject: string | undefined;
  readonly aiJudgeSeatIds: ReadonlySet<string>;
  /** The Round's frozen ballot definition and who its ballots are about. */
  readonly definition: BallotDefinition | null;
  readonly source: BallotDefinitionSource | null;
  readonly subjects: BallotSubjects;
  readonly rows: readonly BallotRow[];
  readonly frozen: FrozenRoundTranscript | null;
}) {
  const own = input.rows.find((b) => b.judgeParticipantId === input.ownSeatId);
  const { frozen } = input;
  const body = (row: BallotRow) => {
    if (!input.definition || !input.source)
      throw createAppError('INVARIANT', 'A ballot on a Round judged by nobody');
    return ballotBody(row, input.definition, input.source, input.subjects);
  };
  return {
    own: input.ownSeatId
      ? {
          participantId: input.ownSeatId,
          ballot: own ? body(own) : null,
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
            const ballot = body(row);
            const own = feedbackFor(ballot.feedback, input.viewerSubject);
            return {
              judge: input.aiJudgeSeatIds.has(row.judgeParticipantId)
                ? ('ai' as const)
                : ('human' as const),
              ballot: {
                ...ballot,
                ...(input.definition?.written.feedback
                  ? { feedback: own }
                  : {}),
              },
              reportableFeedbackId: Object.keys(own).length > 0 ? row.id : null,
            };
          })
        : [],
  };
}
