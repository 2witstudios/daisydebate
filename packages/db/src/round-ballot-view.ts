import { ballotSchema } from '@daisy/protocol';
import type { FrozenRoundTranscript } from './frozen-transcript';
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

/**
 * The caller's own ballot, the frozen transcript for their judging seat, and
 * every ballot only once the Round has completed: no judge reads another's
 * ballot while judging is still open.
 */
export function ballotReadView(input: {
  readonly status: string;
  readonly ownSeatId: string | undefined;
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
        ? input.rows.map((row) => ({
            status: row.status,
            ballot: ballotBody(row),
          }))
        : [],
  };
}
