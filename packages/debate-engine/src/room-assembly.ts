import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol';

import { assemblyOpen, complete, type Edges } from './room-assembly-facts';
export { projectRoom } from './room-projection';
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
  if (command.expectedVersion !== room.version)
    return refuse('version-conflict');
  if (!assemblyOpen(room)) return refuse('room-closed');
  if (hostCommands.has(command.type) && room.hostActorId !== actorId)
    return refuse('host-required');
  const edit = [
    'update-config',
    'update-format',
    'update-details',
    'claim-seat',
    'assign-seat',
    'leave-seat',
    'remove-seat',
  ].includes(command.type);
  if (edit && room.prepStartedAt !== null) return refuse('prep-running');
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
      publishDefinition,
    },
  };
}

const assembledStatus = (room: RoomAssemblyState) =>
  complete(room) ? ('ready' as const) : ('assembling' as const);
