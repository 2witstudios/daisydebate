import { captureUnadmitted } from './room-capture';
import { castHoldsUnadmittedAiJudge } from './ai-judge-seating';
import { castSeatsBotDebater } from './ai-round-cast';
import { acceptedRoomMutation } from './room-assembly-facts';
import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol';

import { startBlocker, type Edges } from './room-assembly-facts';
import { startRoundDraw } from './room-draw-start';
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
export const startRound = (
  room: RoomAssemblyState,
  _actorId: string,
  _command: Extract<RoomCommand, { type: 'start-round' | 'close' }>,
  consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  const blocker = startBlocker(room, consent);
  if (blocker) return refuse(blocker);
  if (castHoldsUnadmittedAiJudge(room, edges.hostHoldsCasualAiJudge))
    return refuse('ai-judge-premium');
  if (captureUnadmitted(room, edges.hostHoldsCasualCapture))
    return refuse('capture-premium');
  if (room.visibility === 'private' && room.capture?.broadcast)
    return refuse('broadcast-private');
  const draw = room.executionPlan.resolutionDraw.enabled
    ? startRoundDraw(room, edges)
    : null;
  if (room.executionPlan.resolutionDraw.enabled && !draw)
    return refuse('draw-unavailable');
  const next: RoomAssemblyState = { ...room, status: 'started' };
  return acceptedRoomMutation(next, {
    draw,
    freeze: true,
    seatsBotDebater: castSeatsBotDebater(next),
  });
};
export const close = (
  room: RoomAssemblyState,
  _actorId: string,
  _command: Extract<RoomCommand, { type: 'start-round' | 'close' }>,
  _consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  return acceptedRoomMutation(closeRoom(room));
};

/** The pure core of closing a Room: the host's command and erasure share it. */
export const closeRoom = (room: RoomAssemblyState): RoomAssemblyState => ({
  ...room,
  status: 'closed',
});
