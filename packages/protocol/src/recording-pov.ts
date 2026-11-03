import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * One debater's own view of a Recording (ADR 0107): their camera and their voice as
 * a private capture beside the composite, offered only as downloads. It has its own
 * Egress, keys and states, and a failed one leaves the Recording ready with this
 * debater listed as missing. Hold keys are a private source, never offered to anyone.
 */

/** What a device could send: 540p where it can, and 360p, labelled, where it cannot. */
export const povQualities = ['540p', '360p'] as const;
export type PovQuality = (typeof povQualities)[number];

/** What one debater's capture gives the build. A null picture is voice alone: a bot. */
export const povBuildSchema = z.strictObject({
  roundParticipantId: idSchema,
  picture: z.enum(povQualities).nullable(),
  /** Zero when no Egress ever ran for this debater, who is then listed as missing. */
  attemptCount: z.int().nonnegative(),
});
export type PovBuild = z.infer<typeof povBuildSchema>;

const objectKey = z.string().min(1).max(512);
const offsetMs = z.int().nonnegative();
const povFileSchema = z.strictObject({
  key: objectKey,
  byteSize: z.int().positive(),
});

/** A stretch of this POV that shows slate, in the composite's video time. */
const povGapSchema = z.strictObject({
  startMs: offsetMs,
  endMs: offsetMs,
  reason: z.enum(['not_public', 'capture_restart']),
});

export const recordingPovSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('built'),
    roundParticipantId: idSchema,
    /** The picture with this debater's voice. Null for a debater with no camera. */
    video: povFileSchema.extend({ quality: z.enum(povQualities) }).nullable(),
    audio: povFileSchema,
    durationMs: z.int().positive(),
    gaps: z.array(povGapSchema).max(10_000),
  }),
  z.strictObject({
    status: z.literal('missing'),
    roundParticipantId: idSchema,
    reason: z.enum(['never_captured', 'nothing_public', 'build_failed']),
  }),
]);
export type RecordingPov = z.infer<typeof recordingPovSchema>;

/** A file of a built POV: never a free key, so nothing else can be asked for. */
export const povFileKinds = ['video', 'audio'] as const;
export type PovFileKind = (typeof povFileKinds)[number];

const HOLD_ROOT = 'recording-hold';

/** Every POV source of a Recording, whichever hold its composite uses. */
export const povHoldRoot = (recordingId: string): string =>
  `${HOLD_ROOT}/${recordingId}/pov/`;

/** Attempts are numbered under this, as a composite's are under its hold prefix. */
export const povHoldPrefix = (
  recordingId: string,
  roundParticipantId: string,
): string => `${povHoldRoot(recordingId)}${roundParticipantId}/`;

/** Names one debater's capture of one Recording, as an Egress's own output says it. */
export const povCaptureId = (
  recordingId: string,
  roundParticipantId: string,
): string => `${recordingId}/${roundParticipantId}`;

/** The capture an Egress writes for, read from its output path; null for any other. */
export const povCaptureIdOfPath = (path: string): string | null => {
  const [root, recordingId, pov, roundParticipantId] = path.split('/');
  return root === HOLD_ROOT &&
    pov === 'pov' &&
    recordingId &&
    roundParticipantId
    ? povCaptureId(recordingId, roundParticipantId)
    : null;
};

/** The kept file, under the Recording's own prefix so removal reaches it as a whole. */
export const povObjectKey = (
  recordingId: string,
  roundParticipantId: string,
  kind: PovFileKind,
): string =>
  `recordings/${recordingId}/pov/${roundParticipantId}/${kind === 'video' ? 'video.mp4' : 'audio.m4a'}`;
