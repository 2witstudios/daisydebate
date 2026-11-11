import {
  runtimeCheckpointSchema,
  type LaunchedRound,
  type RoundRecord,
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

/**
 * One viewer's Round (DEC-98, DEC-174): a human judge's seat names the
 * judge only to that judge and to a seatless host who seated them; everyone
 * else, debaters and spectators alike, sees that the seat is filled. A host
 * who holds a seat gains nothing from hosting (WATCH-6), and a host who
 * inherited the Room is told as anyone is (DEC-331).
 * The host's actor is never sent.
 */
export function roundViewFor(
  round: LaunchedRound,
  viewerActorId: string | null,
): RoundRecord {
  const { hostActorId, hostInherited, ...view } = round;
  const viewerIsHost = viewerActorId !== null && viewerActorId === hostActorId;
  const seated = round.participants.some(
    (seat) => seat.actorId === viewerActorId,
  );
  const knowsJudges = viewerIsHost && !hostInherited && !seated;
  const ownPeople = viewerIsHost || seated;
  return {
    ...view,
    opening: null,
    resolutionAudit: auditFor(round.resolutionAudit, ownPeople),
    viewerIsHost,
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
