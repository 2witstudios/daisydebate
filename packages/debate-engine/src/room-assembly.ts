import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol';

import { assemblyOpen, complete, type Edges } from './room-assembly-facts';
import { activeRoomMembers } from './room-membership';
export { hostIdentityHidden, projectRoom } from './room-projection';
import {
  updateConfig,
  updateDetails,
  claimSeat,
  leaveSeat,
} from './room-edit-transitions';
import {
  ready,
  startPrep,
  finishPrep,
  startRound,
  close,
} from './room-consent-transitions';
const roomTransitions = {
  'update-config': updateConfig,
  'update-format': updateConfig,
  'update-details': updateDetails,
  'claim-seat': claimSeat,
  'assign-seat': claimSeat,
  'leave-seat': leaveSeat,
  'remove-seat': leaveSeat,
  ready,
  unready: ready,
  'start-prep': startPrep,
  'finish-prep': finishPrep,
  'start-round': startRound,
  close,
};
const hostCommands = new Set<RoomCommand['type']>([
  'update-config',
  'update-details',
  'update-format',
  'assign-seat',
  'remove-seat',
  'start-prep',
  'finish-prep',
  'start-round',
  'close',
]);
const editCommands = new Set<RoomCommand['type']>([
  'update-config',
  'update-format',
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
  return edit && room.prepStartedAt !== null ? 'prep-running' : null;
}
/** Pure total transition. The adapter serializes the room and publishes accepted effects atomically. */
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
  const fenced = commandFence(room, actorId, command, edit);
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
    publishDefinition,
  } = outcome.mutation;
  if (edit)
    next = {
      ...next,
      version: room.version + 1,
      participants: next.participants.map((p) => ({
        ...p,
        consentCommandId: null,
      })),
    };
  if (assemblyOpen(next)) next = { ...next, status: assembledStatus(next) };
  next = { ...next, changeVersion: room.changeVersion + 1 };
  return {
    ok: true,
    mutation: {
      state: next,
      consent: consentEffect,
      freeze,
      spendsAiRound,
      publishDefinition,
      members: activeRoomMembers(next),
    },
  };
}

const assembledStatus = (room: RoomAssemblyState) =>
  complete(room) ? ('ready' as const) : ('assembling' as const);
