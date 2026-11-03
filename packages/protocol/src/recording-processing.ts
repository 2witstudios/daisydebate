import { publicIntervalsSchema } from './public-interval';
import { z } from 'zod';
import { recordingFailureReasons, recordingMediaSchema } from './recording';

/** What the processing worker found. Only the web's capture port can make it ready. */
export const builtRecordingMediaSchema = recordingMediaSchema.omit({
  speeches: true,
});
export type BuiltRecordingMedia = z.infer<typeof builtRecordingMediaSchema>;

const at = z.iso.datetime({ offset: false });

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
  z.strictObject({ status: z.literal('settled'), settledAt: at }),
]);
export type RecordingJobState = z.infer<typeof recordingJobStateSchema>;

export const recordingJobStatuses = [
  'waiting',
  'queued',
  'built',
  'failed',
  'discarding',
  'settled',
] as const satisfies readonly RecordingJobState['status'][];
