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
import { ready, startRound, close } from './room-consent-transitions';
import { topicInvariantHolds } from './resolution-draw';
const roomTransitions = {
  'update-config': updateConfig,
  'update-format': updateConfig,
  'select-format': selectFormat,
  'update-details': updateDetails,
  'claim-seat': claimSeat,
  'assign-seat': claimSeat,
  'leave-seat': leaveSeat,
  'remove-seat': leaveSeat,
  ready,
  unready: ready,
  'start-round': startRound,
  close,
};
const hostCommands = new Set<RoomCommand['type']>([
  'update-config',
  'update-details',
  'update-format',
  'select-format',
  'assign-seat',
  'remove-seat',
  'start-round',
  'close',
]);
const editCommands = new Set<RoomCommand['type']>([
  'update-config',
  'update-format',
  'select-format',
  'update-details',
  'claim-seat',
  'assign-seat',
  'leave-seat',
  'remove-seat',
]);
/** The refusal every command meets before its transition, or null. */
function commandFence(
  room: RoomAssemblyState,
  actorId: string,
  command: RoomCommand,
): RoomRefusal | null {
  if (command.expectedVersion !== room.version) return 'version-conflict';
  if (!assemblyOpen(room)) return 'room-closed';
  if (hostCommands.has(command.type) && room.hostActorId !== actorId)
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
  const edit = editCommands.has(command.type);
  const fenced = commandFence(room, actorId, command);
  if (fenced) return refuse(fenced);
  const transition = roomTransitions[command.type] as (
    room: RoomAssemblyState,
    actorId: string,
    command: RoomCommand,
    consent: RoomConsent,
    edges: Edges,
  ) => RoomMutationOutcome;
  const outcome = transition(room, actorId, command, consent, edges);
  if (!outcome.ok) return outcome;
  let next = outcome.mutation.state;
  const {
    consent: consentEffect,
    freeze,
    spendsAiRound,
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
      spendsAiRound,
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
