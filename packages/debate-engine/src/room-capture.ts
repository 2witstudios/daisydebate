import type {
  BroadcastReleasePolicy,
  RoomAssemblyState,
  RoomCapture,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
} from '@daisy/protocol';
import { acceptedRoomMutation, type Edges } from './room-assembly-facts';
import { debatersReadChat, resolveReleasePolicy } from './broadcast-release';

const refuse = (
  refusal: 'capture-premium' | 'broadcast-private' | 'illegal-config',
): RoomMutationOutcome => ({ ok: false, refusal });

const chosen = (capture: RoomCapture): RoomCapture | null =>
  capture.broadcast === null && !capture.recording ? null : capture;

/**
 * The host's capture choice (WATCH-8). The grant is read under the host's
 * fence, and clearing a choice needs none, so losing a grant never traps one.
 */
export const setCapture = (
  room: RoomAssemblyState,
  _actorId: string,
  command: Extract<RoomCommand, { type: 'set-capture' }>,
  _consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  if (room.competitionType === 'ranked') return refuse('illegal-config');
  const capture = chosen(command.capture);
  if (capture && !edges.hostHoldsCasualCapture)
    return refuse('capture-premium');
  if (capture?.broadcast && room.visibility === 'private')
    return refuse('broadcast-private');
  return acceptedRoomMutation({ ...room, capture });
};

/** The Room holds a capture choice its host could not make today. */
export const captureUnadmitted = (
  room: Pick<RoomAssemblyState, 'capture'>,
  hostHoldsCasualCapture: boolean,
): boolean => room.capture !== null && !hostHoldsCasualCapture;

type CaptureFacts = Pick<RoomAssemblyState, 'competitionType' | 'capture'>;

/** The Broadcast a Round opens with, or null when nobody chose one. */
export const plannedBroadcast = (
  room: CaptureFacts,
): {
  readonly releasePolicy: BroadcastReleasePolicy;
  readonly debatersReadChat: boolean;
} | null => {
  const choice = room.capture?.broadcast ?? null;
  if (room.competitionType !== 'ranked' && choice === null) return null;
  return {
    releasePolicy: resolveReleasePolicy(
      room.competitionType,
      choice?.release ?? null,
    ),
    debatersReadChat: debatersReadChat(
      room.competitionType,
      choice?.debatersReadChat ?? false,
    ),
  };
};

/** Ranked is always recorded; a casual Round only by the host's choice. */
export const plannedRecording = (room: CaptureFacts): boolean =>
  room.competitionType === 'ranked' || room.capture?.recording === true;
