import type {
  RoomAssemblyState,
  RoomConsent,
  RoomMutationOutcome,
  RoomParticipant,
  RoomRefusal,
} from '@daisy/protocol';
import {
  formatDefinitionSchema,
  roundRulesSchema,
  seatSlotsComplete,
} from '@daisy/protocol';
import { activeRoomMembers } from './room-membership';
import type { FormatSelectionFacts } from './format-selection';
import type { DrawStartFacts } from './pre-round-phase';
import { preRoundPhase } from './pre-round-phase';
export { prepFinished } from './pre-round-phase';

type Target = RoomParticipant & { readonly eligible: boolean };
export type Edges = {
  readonly now: string;
  readonly participantId: string;
  readonly formatId: string;
  readonly target: Target | null;
  /** What the adapter loaded, under lock, for a select-format tuple (FMT-1). */
  readonly formatFacts?: FormatSelectionFacts | null;
  /** The stored seed (hex) of the Room's draw, for settlement; null without one. */
  readonly drawSeed: string | null;
  /** Facts for a new draw, loaded only for `start-pre-round` on a draw Room. */
  readonly drawStart: DrawStartFacts | null;
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
export const startBlocker = (
  room: RoomAssemblyState,
  consent: RoomConsent,
  now: string,
): RoomRefusal | null => {
  if (!assemblyOpen(room)) return 'room-closed';
  if (
    !formatDefinitionSchema.safeParse(room.definition).success ||
    !roundRulesSchema.safeParse(room.rules).success
  )
    return 'illegal-config';
  if (!complete(room)) return 'incomplete-cast';
  if (room.participants.some((p) => !p.eligible)) return 'actor-ineligible';
  if (!consent.available) return 'readiness-unavailable';
  if (
    room.participants.some(
      (p) => p.kind === 'human' && !consent.readyActorIds.includes(p.actorId),
    )
  )
    return 'not-ready';
  if (preRoundPhase(room, now).phase !== 'satisfied') return 'prep-running';
  if (room.topic === null) return 'illegal-config';
  return null;
};

export const acceptedRoomMutation = (
  state: RoomAssemblyState,
  overrides: Partial<
    Extract<RoomMutationOutcome, { ok: true }>['mutation']
  > = {},
) => ({
  ok: true as const,
  mutation: {
    state,
    consent: null,
    freeze: false,
    publishDefinition: false,
    drawSecrets: null,
    members: activeRoomMembers(state),
    ...overrides,
  },
});
