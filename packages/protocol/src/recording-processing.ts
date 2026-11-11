import { everyMemberOf } from './every-member';
import { publicIntervalsSchema } from './public-interval';
import { z } from 'zod';
import {
  recordingFailureReasons,
  recordingMediaSchema,
  type RecordingLifecycle,
} from './recording';

/** What the processing worker found. Only the web's capture port can make it ready. */
export const builtRecordingMediaSchema = recordingMediaSchema.omit({
  speeches: true,
  unrecorded: true,
});
export type BuiltRecordingMedia = z.infer<typeof builtRecordingMediaSchema>;

const at = z.iso.datetime({ offset: false });

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * How long a build should take, from its capture's end, for media this long: half
 * its length plus five minutes. Past it an operator is alerted and viewers are told
 * it is delayed, and it keeps retrying: a timer never fails or discards a Recording.
 */
export const recordingProcessingBoundMs = (mediaMs: number): number =>
  Math.ceil(mediaMs / 2) + FIVE_MINUTES_MS;

/**
 * How long one run of a build may go on: three times the bound. Past it the run is
 * stopped and counted as a failed attempt, which retries. Nothing is discarded.
 */
export const recordingBuildCeilingMs = (mediaMs: number): number =>
  3 * recordingProcessingBoundMs(mediaMs);

/** A finished capture's length: what a bound or ceiling is sized from. */
export const capturedMediaMs = (capture: {
  readonly startedAt: string;
  readonly endedAt: string;
}): number => Date.parse(capture.endedAt) - Date.parse(capture.startedAt);

/** Whether a finished capture's build has run past its bound. */
export const recordingBuildDelayed = (
  capture: { readonly startedAt: string; readonly endedAt: string },
  nowMs: number,
): boolean => {
  const endedAtMs = Date.parse(capture.endedAt);
  return (
    nowMs - endedAtMs > recordingProcessingBoundMs(capturedMediaMs(capture))
  );
};

/** The steps of a build, in order. A remuxed single attempt skips `composing`. */
export const recordingBuildSteps = [
  'reading',
  'composing',
  'encoding',
  'uploading',
  'verifying',
] as const;

/**
 * How far a running build really is, in the step's own units: attempts read,
 * milliseconds of video encoded as ffmpeg reports them, files uploaded. Never a
 * percentage of the whole, which nothing measures.
 */
const recordingBuildProgressSchema = z.strictObject({
  step: z.enum(recordingBuildSteps),
  done: z.int().nonnegative(),
  total: z.int().nonnegative(),
});
export type RecordingBuildProgress = z.infer<
  typeof recordingBuildProgressSchema
>;

/**
 * One Recording's sources and the work on them (REC-1.2), one value. It exists
 * from the first Egress, so a Recording removed mid-capture still knows what
 * it left in the hold bucket. The worker writes only here and reads nothing
 * else: `built` is a claim the web verifies against the Recording's own state.
 *
 * `waiting`: capture is running. `queued`: claimable, with the attempts to read.
 * `built` and `failed`: the worker is done, the web has not answered yet.
 * `discarding`: claimable, delete the sources. `settled`: nothing is left to do.
 */
export const recordingJobStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('waiting') }),
  z.strictObject({
    status: z.literal('queued'),
    attemptCount: z.int().positive(),
    /** What committed history proves public: only this is built. */
    publicIntervals: publicIntervalsSchema,
    /** How long one run may go on, sized by the web from the capture's length. */
    ceilingMs: z.int().positive().optional(),
    /** Absent until a worker holds it, and again after a run that failed. */
    progress: recordingBuildProgressSchema.optional(),
  }),
  z.strictObject({
    status: z.literal('built'),
    media: builtRecordingMediaSchema,
  }),
  z.strictObject({
    status: z.literal('failed'),
    reason: z.enum(recordingFailureReasons),
    failedAt: at,
  }),
  z.strictObject({ status: z.literal('discarding') }),
  /** A failed Recording's sources are being cut to what history proved public. */
  z.strictObject({
    status: z.literal('stripping'),
    publicIntervals: publicIntervalsSchema,
  }),
  /** Only known-public segments remain, for a rebuild. Not settled: they are kept. */
  z.strictObject({ status: z.literal('stripped'), strippedAt: at }),
  z.strictObject({ status: z.literal('settled'), settledAt: at }),
]);
export type RecordingJobState = z.infer<typeof recordingJobStateSchema>;

/** Every job status, as the stored column's vocabulary: tied to the job state both ways. */
export const recordingJobStatuses = everyMemberOf<
  RecordingJobState['status']
>()([
  'waiting',
  'queued',
  'built',
  'failed',
  'discarding',
  'stripping',
  'stripped',
  'settled',
]);

/** What a viewer of an unfinished Recording is told is happening now. */
export const recordingPreparationSchema = z.discriminatedUnion('stage', [
  z.strictObject({ stage: z.literal('capturing') }),
  z.strictObject({ stage: z.literal('waiting'), delayed: z.boolean() }),
  z.strictObject({
    stage: z.literal('building'),
    delayed: z.boolean(),
    progress: recordingBuildProgressSchema,
  }),
]);
export type RecordingPreparation = z.infer<typeof recordingPreparationSchema>;

/** Null for a Recording that is not being prepared. */
export const recordingPreparationOf = (
  lifecycle: RecordingLifecycle,
  job: RecordingJobState | null,
  nowMs: number,
): RecordingPreparation | null => {
  if (lifecycle.status === 'requested' || lifecycle.status === 'capturing')
    return { stage: 'capturing' };
  if (lifecycle.status !== 'processing') return null;
  const delayed = recordingBuildDelayed(lifecycle.capture, nowMs);
  return job?.status === 'queued' && job.progress
    ? { stage: 'building', delayed, progress: job.progress }
    : { stage: 'waiting', delayed };
};
