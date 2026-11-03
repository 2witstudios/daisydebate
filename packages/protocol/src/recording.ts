import { z } from 'zod';
import { broadcastHoldPrefix } from './broadcast-hold';
import { idSchema } from './primitives';

/**
 * A Recording: a retained playable video of a Round, with its own state and
 * lifetime (ADR 0107). It borrows nothing from Broadcast or the transcript. The
 * lifecycle is one value, so a Recording cannot be both ready and removed, or
 * ready with no media.
 */

/** Ranked video is its own declared class; a casual Recording goes when asked. */
export const recordingClasses = ['ranked', 'casual'] as const;
export type RecordingClass = (typeof recordingClasses)[number];

export const recordingStatuses = [
  'requested',
  'capturing',
  'processing',
  'ready',
  'failed',
  'taken_down',
  'removing',
  'removed',
] as const;
export type RecordingStatus = (typeof recordingStatuses)[number];

/** Why capture was allowed, recorded when it was requested. */
export const recordingEligibilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ranked') }),
  z.strictObject({ kind: z.literal('host_opt_in'), hostActorId: idSchema }),
]);
export type RecordingEligibility = z.infer<typeof recordingEligibilitySchema>;

const at = z.iso.datetime({ offset: false });
const offsetMs = z.int().nonnegative();
const objectKey = z.string().min(1).max(512);

/** A stretch of the video no media covers, stated rather than hidden. */
const coverageGapSchema = z.strictObject({
  startMs: offsetMs,
  endMs: offsetMs,
  reason: z.enum([
    'private_phase',
    'room_rotation',
    'capture_restart',
    'control_lapse',
  ]),
});

/** One accepted turn at the floor, in video time. */
const speechSchema = z.strictObject({
  roundParticipantId: idSchema,
  startMs: offsetMs,
  endMs: offsetMs,
});
export type RecordingSpeech = z.infer<typeof speechSchema>;

/**
 * Where a Recording's source video waits, in the private hold bucket. Named by
 * kind, never as a free path, so a source outside these two cannot be recorded.
 */
export const recordingSourceSchema = z.discriminatedUnion('kind', [
  /** The Round's Broadcast already runs an Egress; its output is read, not owned. */
  z.strictObject({ kind: z.literal('broadcast_hold'), broadcastId: idSchema }),
  /** A casual opted-in Recording with no Broadcast runs its own Egress. */
  z.strictObject({ kind: z.literal('own_capture') }),
]);
export type RecordingSource = z.infer<typeof recordingSourceSchema>;

/** A crash starts a new Egress under a new number, so a capture can have several. */
const captureAttemptSchema = z.strictObject({
  attempt: z.int().positive(),
  egressId: z.string().min(1).max(128),
  startedAt: at,
});

const captureSchema = z.strictObject({
  source: recordingSourceSchema,
  startedAt: at,
  attempts: z.array(captureAttemptSchema).min(1).max(1000),
});

const endedCaptureSchema = captureSchema.extend({ endedAt: at });

/** Verified, playable media. Every key sits under the Recording's own prefix. */
export const recordingMediaSchema = z.strictObject({
  /** The instant video time zero shows: every offset below counts from here. */
  capturedFrom: at,
  playlistKey: objectKey,
  /** The whole video as one file: what a subscriber's download delivers. */
  downloadKey: objectKey,
  durationMs: z.int().positive(),
  byteSize: z.int().positive(),
  verifiedAt: at,
  gaps: z.array(coverageGapSchema).max(10_000),
  speeches: z.array(speechSchema).max(100_000),
});
export type RecordingMedia = z.infer<typeof recordingMediaSchema>;

export const recordingFailureReasons = [
  'capture_failed',
  'no_media',
  'processing_failed',
  'verification_failed',
] as const;

/** Who asked for the whole Recording to go. */
export const recordingRemovalCauses = [
  'participant_request',
  'moderation',
  'failed_capture_cleanup',
] as const;
export type RecordingRemovalCause = (typeof recordingRemovalCauses)[number];

const readySchema = z.strictObject({
  status: z.literal('ready'),
  capture: endedCaptureSchema,
  media: recordingMediaSchema,
});

export const recordingLifecycleSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('requested') }),
  z.strictObject({ status: z.literal('capturing'), capture: captureSchema }),
  z.strictObject({
    status: z.literal('processing'),
    capture: endedCaptureSchema,
  }),
  readySchema,
  z.strictObject({
    status: z.literal('failed'),
    reason: z.enum(recordingFailureReasons),
    failedAt: at,
  }),
  /**
   * Hidden from everyone at once. The objects stay as evidence until moderation
   * removes them; `held` is what a restore puts back, null if it never finished.
   */
  z.strictObject({
    status: z.literal('taken_down'),
    takenDownAt: at,
    held: readySchema.nullable(),
  }),
  /** The durable deletion intent: it outlives the process that asked. */
  z.strictObject({
    status: z.literal('removing'),
    cause: z.enum(recordingRemovalCauses),
    requestedAt: at,
  }),
  z.strictObject({
    status: z.literal('removed'),
    cause: z.enum(recordingRemovalCauses),
    requestedAt: at,
    removedAt: at,
  }),
]);
export type RecordingLifecycle = z.infer<typeof recordingLifecycleSchema>;

/** Every held object of an attempt sits here, whichever Egress wrote it. */
export const recordingHoldPrefix = (
  recordingId: string,
  source: RecordingSource,
): string =>
  source.kind === 'broadcast_hold'
    ? broadcastHoldPrefix(source.broadcastId)
    : `recording-hold/${recordingId}/`;

/** Each Egress attempt writes under its own number, so a restart overwrites nothing. */
export const holdAttemptPrefix = (
  holdPrefix: string,
  attempt: number,
): string => `${holdPrefix}${attempt}/`;
