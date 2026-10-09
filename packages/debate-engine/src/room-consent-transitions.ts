import { acceptedRoomMutation } from './room-assembly-facts';
import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol';

import {
  complete,
  prepFinished,
  startBlocker,
  type Edges,
} from './room-assembly-facts';
const refuse = (refusal: RoomRefusal): RoomMutationOutcome => ({
  ok: false,
  refusal,
});
export const ready = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'ready' | 'unready' }>,
  consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  let next = room;
  let consentEffect: Extract<
    RoomMutationOutcome,
    { ok: true }
  >['mutation']['consent'] = null;

  const held = room.participants.find((p) => p.actorId === actorId);
  if (!held || held.kind !== 'human' || !held.eligible)
    return refuse('not-seated');
  if (command.expectedConsentVersion !== held.consentVersion)
    return refuse('consent-conflict');
  if (command.type === 'ready' && !consent.available)
    return refuse('readiness-unavailable');
  next = {
    ...room,
    participants: room.participants.map((p) =>
      p.actorId === actorId
        ? {
            ...p,
            consentCommandId: command.commandId,
            consentVersion: p.consentVersion + 1,
          }
        : p,
    ),
  };
  consentEffect = {
    type: command.type,
    actorId,
    commandId: command.commandId,
  };
  return acceptedRoomMutation(next, { consent: consentEffect });
};
export const startPrep = (
  room: RoomAssemblyState,
  _actorId: string,
  _command: Extract<RoomCommand, { type: 'start-prep' }>,
  _consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  let next = room;
  if (!complete(room)) return refuse('incomplete-cast');
  if (!room.executionPlan.preRoundPrep.enabled || room.prepStartedAt !== null)
    return refuse('prep-unavailable');
  next = { ...room, prepStartedAt: edges.now };
  return acceptedRoomMutation(next);
};
export const finishPrep = (
  room: RoomAssemblyState,
  _actorId: string,
  _command: Extract<RoomCommand, { type: 'finish-prep' }>,
  _consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  const next = room;
  if (!room.executionPlan.preRoundPrep.enabled || room.prepStartedAt === null)
    return refuse('prep-unavailable');
  if (!prepFinished(room, edges.now)) return refuse('prep-running');
  // Keep the original anchor: a completion acknowledgment cannot restart prep.
  return acceptedRoomMutation(next);
};
export const startRound = (
  room: RoomAssemblyState,
  _actorId: string,
  _command: Extract<RoomCommand, { type: 'start-round' }>,
  consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  let next = room;

  const blocker = startBlocker(room, consent, edges.now);
  if (blocker) return refuse(blocker);
  next = { ...room, status: 'started' };
  return acceptedRoomMutation(next, { freeze: true });
};
export const close = (
  room: RoomAssemblyState,
  _actorId: string,
  _command: Extract<RoomCommand, { type: 'close' }>,
  _consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  let next = room;
  next = { ...room, status: 'abandoned' };
  return acceptedRoomMutation(next);
};
