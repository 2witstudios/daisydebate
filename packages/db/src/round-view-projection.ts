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
/**
 * Struck host-written lines reach the Round's own people only; everyone
 * else keeps the positions, the commitment and the debated line (which is
 * the public topic). Bank lines are Daisy's and stay public.
 */
const auditFor = (
  audit: LaunchedRound['resolutionAudit'],
  ownPeople: boolean,
): LaunchedRound['resolutionAudit'] =>
  !audit || ownPeople || audit.manifest.source.kind !== 'host'
    ? audit
    : {
        ...audit,
        items: audit.items.map((item) =>
          item.position === audit.survivorPosition
            ? item
            : { ...item, text: null },
        ),
        textsWithheld: true,
      };

export function roundViewFor(
  round: LaunchedRound,
  viewerActorId: string | null,
): RoundView {
  const { hostActorId, ...view } = round;
  const knowsJudges = viewerActorId !== null && viewerActorId === hostActorId;
  const ownPeople =
    knowsJudges ||
    round.participants.some((seat) => seat.actorId === viewerActorId);
  return {
    ...view,
    resolutionAudit: auditFor(round.resolutionAudit, ownPeople),
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
