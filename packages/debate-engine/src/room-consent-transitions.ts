import { createAppError } from '@daisy/errors';
import { captureUnadmitted } from './room-capture';
import { castHoldsUnadmittedAiJudge } from './ai-judge-seating';
import { castSeatsBotDebater } from './ai-round-cast';
import { acceptedRoomMutation } from './room-assembly-facts';
import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomExecutionPlan,
  RoomMutationOutcome,
  RoomRefusal,
  RunningRoundStatus,
} from '@daisy/protocol';

import { startBlocker, type Edges } from './room-assembly-facts';
import { startRoundDraw } from './room-draw-start';
import { resolveSeats } from './room-seats';
import { bytesOf } from './draw-random';
const refuse = (refusal: RoomRefusal): RoomMutationOutcome => ({
  ok: false,
  refusal,
});
/** A Round with a draw or pre-round prep to run opens first; with neither it starts at Start round. */
const launchedRoundStatus = (plan: RoomExecutionPlan): RunningRoundStatus =>
  plan.resolutionDraw.enabled || plan.preRoundPrep.enabled
    ? 'opening'
    : 'active';
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
  if (castHoldsUnadmittedAiJudge(room, edges.hostMaySeatCasualAiJudge))
    return refuse('ai-judge-premium');
  if (captureUnadmitted(room, edges.hostHoldsCasualCapture))
    return refuse('capture-premium');
  if (room.visibility === 'private' && room.capture?.broadcast)
    return refuse('broadcast-private');
  // A started Room names its Round from the transition that starts it.
  if (edges.roundId === null || edges.seatSeed === null)
    throw createAppError(
      'INVARIANT',
      'A Start round carries its Round id and seed',
    );
  // Every ? resolves before anything reads a side (ADR 0143): the draw's
  // strike order and automatic sides, bot admission and the frozen cast.
  const seats = resolveSeats(room, {
    seed: bytesOf(edges.seatSeed),
    roundId: edges.roundId,
  });
  const seated: RoomAssemblyState = {
    ...room,
    // Resolved seats are sides, so the started Room's team 1 is whoever now
    // sits Affirmative; the draw keeps which team that was.
    participants: seats.participants,
    teamOneSide: 'affirmative',
  };
  const draw = seated.executionPlan.resolutionDraw.enabled
    ? startRoundDraw(seated, edges)
    : null;
  if (seated.executionPlan.resolutionDraw.enabled && !draw)
    return refuse('draw-unavailable');
  const next: RoomAssemblyState = {
    ...seated,
    status: 'started',
    roundRef: {
      id: edges.roundId,
      status: launchedRoundStatus(room.executionPlan),
    },
  };
  return acceptedRoomMutation(next, {
    draw,
    seatDraw: seats.seatDraw,
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
