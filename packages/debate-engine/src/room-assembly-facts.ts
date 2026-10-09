import type {
  RoomAssemblyState,
  RoomConsent,
  RoomMutationOutcome,
  RoomParticipant,
  RoomRefusal,
} from '@daisy/protocol';
import { seatSlotsComplete } from '@daisy/protocol';

type Target = RoomParticipant & { readonly eligible: boolean };
export type Edges = {
  readonly now: string;
  readonly participantId: string;
  readonly formatId: string;
  readonly target: Target | null;
};
export const assemblyOpen = (room: RoomAssemblyState) =>
  room.status === 'assembling' || room.status === 'ready';
export const complete = (room: RoomAssemblyState) =>
  Object.entries(room.rules.seats).every(([role, count]) =>
    seatSlotsComplete(
      count,
      room.participants
        .filter((p) => p.role === role)
        .map((p) => p.slot)
        .sort((a, b) => a - b),
    ),
  );
export const prepFinished = (room: RoomAssemblyState, now: string) =>
  !room.executionPlan.preRoundPrep.enabled ||
  (room.prepStartedAt !== null &&
    room.prepRemainingMs !== null &&
    Date.parse(room.prepStartedAt) + room.prepRemainingMs <= Date.parse(now));
export const startBlocker = (
  room: RoomAssemblyState,
  consent: RoomConsent,
  now: string,
): RoomRefusal | null => {
  if (!assemblyOpen(room)) return 'room-closed';
  if (!complete(room)) return 'incomplete-cast';
  if (room.participants.some((p) => !p.eligible)) return 'actor-ineligible';
  if (!consent.available) return 'readiness-unavailable';
  if (
    room.participants.some(
      (p) => p.kind === 'human' && !consent.readyActorIds.includes(p.actorId),
    )
  )
    return 'not-ready';
  if (!prepFinished(room, now)) return 'prep-running';
  return null;
};

export const acceptedRoomMutation = (
  state: RoomAssemblyState,
  overrides: Partial<
    Extract<RoomMutationOutcome, { ok: true }>['mutation']
  > = {},
): RoomMutationOutcome => ({
  ok: true,
  mutation: {
    state,
    consent: null,
    freeze: false,
    publishDefinition: false,
    ...overrides,
  },
});
