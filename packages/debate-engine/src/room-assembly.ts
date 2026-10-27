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
  finishPrep,
  startRound,
  close,
} from './room-consent-transitions';
import { startPreRound, strikeResolution } from './room-pre-round';
import { preRoundBegun } from './pre-round-phase';
import { settleRoom, topicInvariantHolds } from './resolution-draw';
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
  'start-pre-round': startPreRound,
  'strike-resolution': strikeResolution,
  'finish-prep': finishPrep,
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
  'start-pre-round',
  'finish-prep',
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
  edit: boolean,
): RoomRefusal | null {
  if (command.expectedVersion !== room.version) return 'version-conflict';
  if (!assemblyOpen(room)) return 'room-closed';
  if (hostCommands.has(command.type) && room.hostActorId !== actorId)
    return 'host-required';
  return edit && preRoundBegun(room) ? 'prep-running' : null;
}
/**
 * Pure total transition. Due draw strikes settle first and are kept only
 * when the command is accepted; the adapter serializes the room and
 * publishes accepted effects atomically.
 */
export function executeRoomCommand(
  stored: RoomAssemblyState,
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
  const fenced = commandFence(stored, actorId, command, edit);
  if (fenced) return refuse(fenced);
  const room = settleRoom(stored, edges.drawSeed, edges.now);
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
    publishDefinition,
    drawSecrets,
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
      publishDefinition,
      drawSecrets,
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
 * Privacy erasure of a seated player before any pre-round: their seats go
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
