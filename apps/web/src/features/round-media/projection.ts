import { createRoundRuntime, mediaGrants } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';
import type { RoundMediaState } from '@daisy/protocol';

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
export const mediaEnded = (
  snapshot: Pick<MediaSnapshot, 'round' | 'now' | 'finalSegmentEndedAt'>,
) =>
  ['completed', 'abandoned'].includes(snapshot.round.status) ||
  (snapshot.finalSegmentEndedAt !== null &&
    Date.parse(snapshot.now) >=
      Date.parse(snapshot.finalSegmentEndedAt) + 30 * 60_000);
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
    'round' | 'now' | 'finalSegmentEndedAt' | 'participants' | 'withdrawn'
  >,
  participantId: string,
  nextId: () => string,
) =>
  mediaGrants({
    participants: snapshot.withdrawn.includes(participantId)
      ? snapshot.participants.map((seat) =>
          seat.id === participantId ? { ...seat, eligible: false } : seat,
        )
      : snapshot.participants,
    participantId,
    rules: snapshot.round.rules,
    position: mediaRuntime(snapshot, nextId).position(snapshot.now),
    now: snapshot.now,
    finalSegmentEndedAt: snapshot.finalSegmentEndedAt,
  });

export function projectMedia(
  snapshot: MediaSnapshot,
  ready: boolean,
  nextId: () => string,
): RoundMediaState {
  const ended = mediaEnded(snapshot) || snapshot.session.endedAt !== null;
  const state = ended
    ? 'ended'
    : ready &&
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
          return seat && seat.role !== 'judge'
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
  };
}
