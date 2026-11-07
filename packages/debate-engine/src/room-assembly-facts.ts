import { topicInvariantHolds } from './resolution-draw';
import type {
  RoomAssemblyState,
  RoomConsent,
  RoomMutationOutcome,
  RoomParticipant,
  RoomRefusal,
  PublishedResolution,
} from '@daisy/protocol';
import {
  formatDefinitionSchema,
  roundRulesSchema,
  seatSlotsComplete,
} from '@daisy/protocol';
import { activeRoomMembers } from './room-membership';
import type { FormatSelectionFacts } from './format-selection';
import type { DrawStartFacts } from './room-draw-start';

type Target = RoomParticipant & {
  readonly eligible: boolean;
  /**
   * Which seat an AI actor may hold (ISSUE-750): a bot debater only a side,
   * the AI judge only the judge seat. Null for a human.
   */
  readonly seatRole: 'debater' | 'judge' | null;
};
export type Edges = {
  readonly now: string;
  readonly participantId: string;
  readonly formatId: string;
  readonly target: Target | null;
  /**
   * The host's casual AI judge entitlement (WATCH-16), read under the host's
   * account fence. It says nothing on a ranked Room, where the seat is free.
   */
  readonly hostMaySeatCasualAiJudge: boolean;
  /** The host's casual capture entitlement (WATCH-8), read the same way. */
  readonly hostHoldsCasualCapture: boolean;
  /** What the adapter loaded, under lock, for a select-format tuple (FMT-1). */
  readonly formatFacts?: FormatSelectionFacts | null;
  readonly resolutionPublication?: PublishedResolution | null;
  /** Facts for a new draw, loaded only for `start-round` on a draw Room. */
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
/**
 * Why the seated cast can't go on yet, or null: every seat eligible, Ready
 * readable and every human Ready. The draw and Launch both wait on it.
 */
const castGate = (
  room: RoomAssemblyState,
  consent: RoomConsent,
): RoomRefusal | null => {
  if (
    room.participants.some(
      (p) =>
        !p.eligible ||
        (room.competitionType === 'ranked' &&
          p.role !== 'judge' &&
          p.kind !== 'human'),
    )
  )
    return 'actor-ineligible';
  if (!consent.available) return 'readiness-unavailable';
  return room.participants.some(
    (p) => p.kind === 'human' && !consent.readyActorIds.includes(p.actorId),
  )
    ? 'not-ready'
    : null;
};
export const startBlocker = (
  room: RoomAssemblyState,
  consent: RoomConsent,
): RoomRefusal | null => {
  if (!assemblyOpen(room)) return 'room-closed';
  if (
    !formatDefinitionSchema.safeParse(room.definition).success ||
    !roundRulesSchema.safeParse(room.rules).success
  )
    return 'illegal-config';
  if (!complete(room)) return 'incomplete-cast';
  const cast = castGate(room, consent);
  if (cast) return cast;
  if (!topicInvariantHolds(room)) return 'illegal-config';
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
    seatsBotDebater: false,
    publishDefinition: false,
    draw: null,
    members: activeRoomMembers(state),
    ...overrides,
  },
});

/**
 * Whether the host may name the Room's human judges: only a seatless host who
 * did not inherit the Room. A seat gains nothing from hosting (WATCH-6), and an
 * heir did not seat them (DEC-331).
 */
export const hostNamesJudges = (
  room: Pick<
    RoomAssemblyState,
    'hostActorId' | 'hostInherited' | 'participants'
  >,
): boolean =>
  !room.hostInherited &&
  !room.participants.some((p) => p.actorId === room.hostActorId);
