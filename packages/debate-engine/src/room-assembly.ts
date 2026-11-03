import { createAppError } from '@daisy/errors';
import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol';

import { assemblyOpen, complete, type Edges } from './room-assembly-facts';
import { activeRoomMembers } from './room-membership';
import { removeSeat } from './room-edit-transitions';
export { hostIdentityHidden, projectRoom } from './room-projection';
import {
  selectFormat,
  updateConfig,
  updateDetails,
  claimSeat,
  leaveSeat,
} from './room-edit-transitions';
import {
  ready,
  startRound,
  close,
  closeRoom,
} from './room-consent-transitions';
import { topicInvariantHolds } from './resolution-draw';
type RoomCommandType = RoomCommand['type'];
/** Who may run a Room command, whether it asks every seat to ready again, and what it does. */
type RoomCommandPolicy<T extends RoomCommandType> = {
  readonly authority: 'host' | 'member';
  readonly edit: boolean;
  readonly transition: (
    room: RoomAssemblyState,
    actorId: string,
    command: RoomCommand & { readonly type: T },
    consent: RoomConsent,
    edges: Edges,
  ) => RoomMutationOutcome;
};
/** Keyed by every command: a new one does not compile until all three are stated. */
export type RoomCommandPolicies = {
  readonly [T in RoomCommandType]: RoomCommandPolicy<T>;
};
const hostEdit = { authority: 'host', edit: true } as const;
const memberEdit = { authority: 'member', edit: true } as const;
const roomCommandPolicies: RoomCommandPolicies = {
  'update-config': { ...hostEdit, transition: updateConfig },
  'update-format': { ...hostEdit, transition: updateConfig },
  'select-format': { ...hostEdit, transition: selectFormat },
  'update-details': { ...hostEdit, transition: updateDetails },
  'assign-seat': { ...hostEdit, transition: claimSeat },
  'remove-seat': { ...hostEdit, transition: leaveSeat },
  'claim-seat': { ...memberEdit, transition: claimSeat },
  'leave-seat': { ...memberEdit, transition: leaveSeat },
  ready: { authority: 'member', edit: false, transition: ready },
  unready: { authority: 'member', edit: false, transition: ready },
  'start-round': { authority: 'host', edit: false, transition: startRound },
  close: { authority: 'host', edit: false, transition: close },
};
/** The refusal every command meets before its transition, or null. */
function commandFence(
  room: RoomAssemblyState,
  actorId: string,
  command: RoomCommand,
): RoomRefusal | null {
  if (command.expectedVersion !== room.version) return 'version-conflict';
  if (!assemblyOpen(room)) return 'room-closed';
  if (
    roomCommandPolicies[command.type].authority === 'host' &&
    room.hostActorId !== actorId
  )
    return 'host-required';
  return null;
}
/**
 * Pure total transition; the adapter serializes the room and publishes
 * accepted effects atomically.
 */
export function executeRoomCommand(
  room: RoomAssemblyState,
  actorId: string,
  command: RoomCommand,
  consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome {
  const refuse = (refusal: RoomRefusal): RoomMutationOutcome => ({
    ok: false,
    refusal,
  });
  const { edit, transition } = roomCommandPolicies[
    command.type
  ] as RoomCommandPolicy<RoomCommandType>;
  const fenced = commandFence(room, actorId, command);
  if (fenced) return refuse(fenced);
  const outcome = transition(room, actorId, command, consent, edges);
  if (!outcome.ok) return outcome;
  let next = outcome.mutation.state;
  const {
    consent: consentEffect,
    freeze,
    seatsBotDebater,
    publishDefinition,
    draw,
  } = outcome.mutation;
  if (edit) next = afterEdit(room, next);
  if (assemblyOpen(next)) next = { ...next, status: assembledStatus(next) };
  next = { ...next, changeVersion: room.changeVersion + 1 };
  if (!topicInvariantHolds(next))
    throw createAppError(
      'INVARIANT',
      'A Room mutation broke the topic invariant',
    );
  return {
    ok: true,
    mutation: {
      state: next,
      consent: consentEffect,
      freeze,
      seatsBotDebater,
      publishDefinition,
      draw,
      members: activeRoomMembers(next),
    },
  };
}

const assembledStatus = (room: RoomAssemblyState) =>
  complete(room) ? ('ready' as const) : ('assembling' as const);

/** An edit bumps the version and asks every seat to ready again. */
const afterEdit = (
  room: RoomAssemblyState,
  next: RoomAssemblyState,
): RoomAssemblyState => ({
  ...next,
  version: room.version + 1,
  participants: next.participants.map((p) => ({
    ...p,
    consentCommandId: null,
  })),
});

/**
 * Privacy erasure of a seated player before Start round: their seats go
 * as if they had left, under the erasure's authority instead of a command.
 */
export const eraseSeats = (
  room: RoomAssemblyState,
  actorId: string,
): RoomAssemblyState => {
  const next = afterEdit(
    room,
    room.participants
      .filter((p) => p.actorId === actorId)
      .reduce((held, seat) => removeSeat(held, seat.id), room),
  );
  return assemblyOpen(next) ? { ...next, status: assembledStatus(next) } : next;
};

/**
 * A restriction on a member before Start round (DEC-331): their seats go and
 * the Room stays open for the others. Only a host can start a Room, so a
 * restricted host passes it to the first human still seated; with no human
 * left there is nobody to keep it open for, and it closes.
 */
export const releaseRestrictedMember = (
  room: RoomAssemblyState,
  actorId: string,
): RoomAssemblyState => {
  const freed = eraseSeats(room, actorId);
  if (freed.hostActorId !== actorId) return freed;
  const heir = freed.participants.find((p) => p.kind === 'human');
  return heir
    ? { ...freed, hostActorId: heir.actorId, hostLabel: heir.label }
    : closeRoom(freed);
};
