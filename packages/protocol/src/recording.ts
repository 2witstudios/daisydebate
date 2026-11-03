import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * A Recording: a retained playable video of a Round, with its own state and
 * lifetime (ADR 0105). It borrows nothing from Broadcast or the transcript. The
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
  reason: z.enum(['private_phase', 'room_rotation', 'capture_restart']),
});

/** One accepted turn at the floor, in video time. */
const speechSchema = z.strictObject({
  roundParticipantId: idSchema,
  startMs: offsetMs,
  endMs: offsetMs,
});
export type RecordingSpeech = z.infer<typeof speechSchema>;

const captureSchema = z.strictObject({
  egressId: z.string().min(1).max(128),
  startedAt: at,
});

const endedCaptureSchema = captureSchema.extend({
  endedAt: at,
  sourceKey: objectKey,
});

/** Verified, playable media. Every key sits under the Recording's own prefix. */
export const recordingMediaSchema = z.strictObject({
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
