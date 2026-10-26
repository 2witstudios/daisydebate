import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol';

import { resolveRoomConfiguration } from './resolve-room-configuration';

import { acceptedRoomMutation, type Edges } from './room-assembly-facts';
const refuse = (refusal: RoomRefusal): RoomMutationOutcome => ({
  ok: false,
  refusal,
});
export const updateConfig = (
  room: RoomAssemblyState,
  _actorId: string,
  command: Extract<RoomCommand, { type: 'update-config' | 'update-format' }>,
  _consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  let next = room;
  let publishDefinition = false;

  if (room.competitionType === 'ranked') return refuse('illegal-config');
  const definition =
    command.type === 'update-format' ? command.definition : room.definition;
  const resolved = resolveRoomConfiguration(definition, command.config);
  if (!resolved.ok) return refuse('illegal-config');
  if (room.participants.some((p) => p.slot >= resolved.rules.seats[p.role]))
    return refuse('seat-unavailable');
  publishDefinition = command.type === 'update-format';
  next = {
    ...room,
    config: command.config,
    definition,
    rules: resolved.rules,
    executionPlan: resolved.roomPlan,
    formatId: publishDefinition ? edges.formatId : room.formatId,
    formatVersion: publishDefinition ? 1 : room.formatVersion,
    prepStartedAt: null,
    prepRemainingMs: resolved.roomPlan.preRoundPrep.enabled
      ? resolved.roomPlan.preRoundPrep.durationMs
      : null,
  };
  return acceptedRoomMutation(next, { publishDefinition });
};
export const updateDetails = (
  room: RoomAssemblyState,
  _actorId: string,
  command: Extract<RoomCommand, { type: 'update-details' }>,
  _consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  let next = room;
  next = {
    ...room,
    title: command.title,
    topic: command.topic,
    visibility: command.visibility,
  };
  return acceptedRoomMutation(next);
};
const seatAdmission = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'claim-seat' | 'assign-seat' }>,
  target: Edges['target'],
): RoomRefusal | null => {
  const targetId = command.type === 'claim-seat' ? actorId : command.actorId;
  if (!target || target.actorId !== targetId || !target.eligible)
    return 'actor-ineligible';
  if (command.type === 'claim-seat' && target.kind !== 'human')
    return 'actor-ineligible';
  if (unjoinedHuman(room, actorId, command.type, target))
    return 'actor-ineligible';
  return null;
};
export const claimSeat = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'claim-seat' | 'assign-seat' }>,
  _consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  let next = room;

  const target = edges.target;
  const targetId = command.type === 'claim-seat' ? actorId : command.actorId;
  const admission = seatAdmission(room, actorId, command, target);
  if (admission) return refuse(admission);
  if (!target) return refuse('actor-ineligible');
  if (
    command.slot >= room.rules.seats[command.role] ||
    room.participants.some(
      (p) =>
        p.role === command.role &&
        p.slot === command.slot &&
        p.actorId !== targetId,
    )
  )
    return refuse('seat-unavailable');
  const existing = room.participants.find((p) => p.actorId === targetId);
  next = {
    ...room,
    participants: [
      ...room.participants.filter((p) => p.actorId !== targetId),
      {
        ...target,
        id: existing?.id ?? edges.participantId,
        role: command.role,
        slot: command.slot,
        consentCommandId: null,
      },
    ],
  };
  return acceptedRoomMutation(next);
};
export const leaveSeat = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'leave-seat' | 'remove-seat' }>,
  _consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  let next = room;

  const held = room.participants.find((p) =>
    command.type === 'leave-seat'
      ? p.actorId === actorId
      : p.id === command.participantId,
  );
  if (!held) return refuse('not-seated');
  next = {
    ...room,
    participants: room.participants.filter((p) => p.id !== held.id),
  };
  return acceptedRoomMutation(next);
};

const unjoinedHuman = (
  room: RoomAssemblyState,
  actorId: string,
  type: string,
  target: NonNullable<Edges['target']>,
) =>
  type === 'assign-seat' &&
  target.kind === 'human' &&
  target.actorId !== actorId &&
  !room.participants.some((p) => p.actorId === target.actorId);
