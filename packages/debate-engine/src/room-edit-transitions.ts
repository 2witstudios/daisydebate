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
  const topic = nextTopic(
    room,
    resolved.roomPlan.resolutionDraw.enabled,
    command.topic,
  );
  if (topic === undefined) return refuse('illegal-config');
  publishDefinition = command.type === 'update-format';
  next = {
    ...room,
    config: command.config,
    definition,
    rules: resolved.rules,
    executionPlan: resolved.roomPlan,
    formatId: publishDefinition ? edges.formatId : room.formatId,
    formatVersion: publishDefinition ? 1 : room.formatVersion,
    topic,
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
  const draw = room.executionPlan.resolutionDraw.enabled;
  if (draw === (command.topic !== undefined)) return refuse('illegal-config');
  return acceptedRoomMutation({
    ...room,
    title: command.title,
    topic: command.topic ?? null,
    visibility: command.visibility,
  });
};

/**
 * The topic after a config change, or undefined when the command breaks the
 * rule: turning a draw on carries `topic: null`, turning it off carries the
 * replacement text, and keeping the draw state carries no topic.
 */
const nextTopic = (
  room: RoomAssemblyState,
  drawAfter: boolean,
  topic: string | null | undefined,
): string | null | undefined => {
  const drawBefore = room.executionPlan.resolutionDraw.enabled;
  if (drawBefore === drawAfter)
    return topic === undefined ? room.topic : undefined;
  if (drawAfter) return topic === null ? null : undefined;
  return typeof topic === 'string' ? topic : undefined;
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
/** Removes one seat: the pure core of leaving, removal and erasure. */
export const removeSeat = (
  room: RoomAssemblyState,
  participantId: string,
): RoomAssemblyState => ({
  ...room,
  participants: room.participants.filter((p) => p.id !== participantId),
});
export const leaveSeat = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'leave-seat' | 'remove-seat' }>,
  _consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  const held = room.participants.find((p) =>
    command.type === 'leave-seat'
      ? p.actorId === actorId
      : p.id === command.participantId,
  );
  if (!held) return refuse('not-seated');
  return acceptedRoomMutation(removeSeat(room, held.id));
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
