import {
  createRoundRuntime,
  inPreRoundPrep,
  mediaGrants,
  mediaPhase,
  postRoundCallGrants,
} from '@daisy/debate-engine';
import type { Database } from '@daisy/db';
import { conversational, type RoundMediaState } from '@daisy/protocol';

type Store = Database['mediaSessions'];
export type MediaSnapshot = NonNullable<
  Awaited<ReturnType<Store['readMediaSession']>>
>;
export const mediaRuntime = (
  context: Pick<MediaSnapshot, 'round'>,
  nextId: () => string,
) =>
  createRoundRuntime({
    ...context.round,
    round: context.round,
    nextSegmentId: nextId,
  });
/** Where this snapshot's media stands, by the engine's one rule. */
export const mediaPhaseOf = (snapshot: Pick<MediaSnapshot, 'mediaWindow'>) =>
  mediaPhase(snapshot.mediaWindow);
export const mediaEnded = (snapshot: Pick<MediaSnapshot, 'mediaWindow'>) =>
  mediaPhaseOf(snapshot) === 'closed';
/** A post-round call waits for the Round's room to be proven gone (ADR 0126). */
export const callOpening = (snapshot: Pick<MediaSnapshot, 'mediaWindow'>) =>
  mediaPhaseOf(snapshot) === 'post-round-call-opening';
const onCall = (snapshot: Pick<MediaSnapshot, 'mediaWindow'>) =>
  mediaPhaseOf(snapshot) === 'post-round-call';
/** This seat itself has lost its place, as opposed to another's revocation rotating the room. */
export const ownSeatRevoked = (
  snapshot: Pick<MediaSnapshot, 'participants'>,
  participantId: string,
) =>
  snapshot.participants.some(
    (seat) =>
      seat.id === participantId && seat.kind === 'human' && !seat.eligible,
  );
/** Issued old-room tokens require rotation; departed unbound seats cannot veto it. */
export const admissionRevoked = (
  snapshot: Pick<MediaSnapshot, 'participants'> & {
    readonly bindings: readonly { readonly roundParticipantId: string }[];
  },
) =>
  snapshot.bindings.some((binding) =>
    snapshot.participants.some(
      (seat) =>
        seat.id === binding.roundParticipantId &&
        seat.kind === 'human' &&
        !seat.eligible,
    ),
  );
/**
 * A seat's media grants. A withdrawn seat (a human whose participant access
 * was revoked, ISSUE-714) gets none: the next reconcile demotes it in the
 * room. Only that seat is treated as ineligible, so every other seat's
 * grants, the opponent's floor included, are computed as before.
 */
export const seatGrants = (
  snapshot: Pick<
    MediaSnapshot,
    | 'round'
    | 'now'
    | 'finalSegmentEndedAt'
    | 'participants'
    | 'withdrawn'
    | 'conversationHeld'
    | 'cameraHeld'
    | 'mediaWindow'
  >,
  participantId: string,
  nextId: () => string,
) => {
  if (onCall(snapshot)) {
    const seat = snapshot.participants.find(
      (candidate) => candidate.id === participantId,
    );
    return postRoundCallGrants(
      seat && snapshot.withdrawn.includes(participantId)
        ? { ...seat, eligible: false }
        : seat,
    );
  }
  return mediaGrants({
    participants: snapshot.withdrawn.includes(participantId)
      ? snapshot.participants.map((seat) =>
          seat.id === participantId ? { ...seat, eligible: false } : seat,
        )
      : snapshot.participants,
    participantId,
    rules: snapshot.round.rules,
    position: mediaRuntime(snapshot, nextId).position(snapshot.now),
    now: snapshot.now,
    inPreRoundPrep:
      snapshot.round.opening !== null &&
      inPreRoundPrep({
        opening: snapshot.round.opening.state,
        seed: snapshot.round.opening.seed,
        now: snapshot.now,
      }),
    finalSegmentEndedAt: snapshot.finalSegmentEndedAt,
    conversationHeld: snapshot.conversationHeld,
    cameraHeld: snapshot.cameraHeld,
  });
};

const HELD_ALERT_MS = 30_000;

/** Conversation that should be open has waited too long for the observer (ADR 0099). */
export const conversationHeldOverdue = (
  snapshot: Pick<
    MediaSnapshot,
    'round' | 'now' | 'finalSegmentEndedAt' | 'conversationHeld' | 'mediaWindow'
  >,
  nextId: () => string,
): boolean => {
  // Only the Round's own conversation waits on an observer.
  if (!snapshot.conversationHeld || mediaPhaseOf(snapshot) !== 'round')
    return false;
  if (!conversational(mediaRuntime(snapshot, nextId).position(snapshot.now)))
    return false;
  const since = snapshot.finalSegmentEndedAt ?? snapshot.round.launchedAt;
  return Date.parse(snapshot.now) - Date.parse(since) > HELD_ALERT_MS;
};

export function projectMedia(
  snapshot: MediaSnapshot,
  ready: boolean,
  nextId: () => string,
): RoundMediaState {
  const ended = mediaEnded(snapshot) || snapshot.session.endedAt !== null;
  const state = ended
    ? 'ended'
    : ready &&
        !callOpening(snapshot) &&
        !snapshot.session.unsafeAt &&
        !snapshot.unresolved &&
        !admissionRevoked(snapshot)
      ? 'ready'
      : 'unavailable';
  const denied: RoundMediaState['grants'] = {
    publish: [],
    subscribe: false,
    hidden: false,
    capture: false,
  };
  return {
    version: 1,
    roundId: snapshot.round.id,
    state,
    mediaRoomName: snapshot.session.roomName,
    grants:
      state === 'ready' && snapshot.caller
        ? {
            ...seatGrants(snapshot, snapshot.caller.id, nextId),
            publish: [
              ...seatGrants(snapshot, snapshot.caller.id, nextId).publish,
            ],
          }
        : denied,
    peers: ended
      ? []
      : snapshot.bindings.flatMap((binding) => {
          const seat = snapshot.participants.find(
            (seat) => seat.id === binding.roundParticipantId,
          );
          // A bot is never on a post-round call.
          return seat &&
            seat.role !== 'judge' &&
            (seat.kind === 'human' || !onCall(snapshot))
            ? [
                {
                  participantId: seat.id,
                  identity: binding.identity,
                  microphone:
                    state === 'ready' &&
                    seatGrants(snapshot, seat.id, nextId).publish.includes(
                      'microphone',
                    ),
                },
              ]
            : [];
        }),
    ...(ended || !onCall(snapshot)
      ? {}
      : {
          callJudges: snapshot.bindings.flatMap((binding) => {
            const seat = snapshot.participants.find(
              (seat) => seat.id === binding.roundParticipantId,
            );
            return seat?.role === 'judge' && seat.kind === 'human'
              ? [
                  {
                    slot: seat.slot,
                    identity: binding.identity,
                    microphone:
                      state === 'ready' &&
                      seatGrants(snapshot, seat.id, nextId).publish.includes(
                        'microphone',
                      ),
                  },
                ]
              : [];
          }),
        }),
  };
}
