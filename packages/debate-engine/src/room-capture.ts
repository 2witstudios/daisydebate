import type {
  BroadcastReleasePolicy,
  RoomAssemblyState,
  RoomCapture,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RecordingPolicy,
  RatingDivision,
} from '@daisy/protocol';
import { acceptedRoomMutation, type Edges } from './room-assembly-facts';
import { debatersReadChat, resolveReleasePolicy } from './broadcast-release';

const refuse = (
  refusal: 'capture-premium' | 'broadcast-private' | 'illegal-config',
): RoomMutationOutcome => ({ ok: false, refusal });

const chosen = (capture: RoomCapture): RoomCapture | null =>
  capture.broadcast === null && capture.recordingPolicy === 'off'
    ? null
    : capture;

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

/** A started Round's capture facts: its ladder division is frozen at Start. */
type RoundCaptureFacts = CaptureFacts & {
  readonly ladderDivision: RatingDivision | null;
};

/**
 * The Broadcast a Round opens with, or null when nobody chose one. A Youth
 * Round is never broadcast to an audience (ADR 0107, PYL-5): its Recording
 * runs its own Egress and stays private.
 */
export const plannedBroadcast = (
  room: RoundCaptureFacts,
): {
  readonly releasePolicy: BroadcastReleasePolicy;
  readonly debatersReadChat: boolean;
} | null => {
  if (room.ladderDivision === 'youth') return null;
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

/**
 * Who a Round's Recording is for: a ranked Round's is always released; a
 * casual Round's is the host's choice, and none without one.
 */
export const plannedRecording = (room: CaptureFacts): RecordingPolicy =>
  room.competitionType === 'ranked'
    ? 'released'
    : (room.capture?.recordingPolicy ?? 'off');
