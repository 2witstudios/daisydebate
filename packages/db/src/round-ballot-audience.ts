import { ballotWrittenRecordSchema, type Ballot } from '@daisy/protocol';
import type { BallotPart } from '@daisy/protocol/lobby/results-read';

/** Current evaluator decisions, on the same fenced event source as the Round read. */
export type RoundBallotAccess = {
  readonly parts: readonly BallotPart[];
  readonly unreleased: boolean;
};

export type BallotScreeningRead = {
  readonly status: string;
  readonly releasedText: unknown;
};

/** No completion, missing screening row or malformed copy opens original written text. */
export const eventBallotForAudience = (
  ballot: Ballot,
  access: RoundBallotAccess,
  screening: BallotScreeningRead | null,
): Ballot => {
  const parts = new Set(access.parts);
  const cleared =
    screening?.status === 'clear'
      ? ballotWrittenRecordSchema.safeParse(screening.releasedText)
      : null;
  const text = access.unreleased
    ? ballot
    : cleared?.success
      ? cleared.data
      : null;
  return {
    rubricVersion: ballot.rubricVersion,
    ...(parts.has('decision')
      ? {
          ...(ballot.decision === undefined
            ? {}
            : { decision: ballot.decision }),
          ...(ballot.winner === undefined ? {} : { winner: ballot.winner }),
          ...(ballot.ranking === undefined ? {} : { ranking: ballot.ranking }),
        }
      : {}),
    ...(parts.has('scores')
      ? {
          ...(ballot.scores === undefined ? {} : { scores: ballot.scores }),
          ...(ballot.speakerRanks === undefined
            ? {}
            : { speakerRanks: ballot.speakerRanks }),
        }
      : {}),
    ...(parts.has('reason') && text?.reason !== undefined
      ? { reason: text.reason }
      : {}),
    ...(parts.has('feedback') && text?.feedback !== undefined
      ? { feedback: text.feedback }
      : {}),
    ...(access.unreleased &&
    parts.has('reason') &&
    ballot.citations !== undefined
      ? { citations: ballot.citations }
      : {}),
  };
};
