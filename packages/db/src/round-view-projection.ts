import {
  runtimeCheckpointSchema,
  type LaunchedRound,
  type RoundView,
  type RuntimeCheckpoint,
} from '@daisy/protocol';

/**
 * The stored checkpoint, or null when it no longer reads as one: the Round
 * and its receipt still read, and the room shows no live position.
 */
export const readableCheckpoint = (
  value: unknown,
): RuntimeCheckpoint | null => {
  const parsed = runtimeCheckpointSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * One viewer's Round (DEC-98, DEC-174): a human judge's seat names the
 * judge only to that judge and to the host who seated them; everyone else,
 * debaters and spectators alike, sees that the seat is filled. The host's
 * actor is never sent.
 */
export function roundViewFor(
  round: LaunchedRound,
  viewerActorId: string | null,
): RoundView {
  const { hostActorId, ...view } = round;
  const knowsJudges = viewerActorId !== null && viewerActorId === hostActorId;
  return {
    ...view,
    viewerIsHost: knowsJudges,
    participants: round.participants.map((seat) =>
      seat.role !== 'judge' ||
      seat.kind === 'bot' ||
      knowsJudges ||
      seat.actorId === viewerActorId
        ? seat
        : {
            role: 'judge',
            kind: 'human',
            slot: seat.slot,
            anonymous: true,
          },
    ),
  };
}
