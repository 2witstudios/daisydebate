import { z } from 'zod';
import { idSchema } from './primitives';
const instant = z.iso.datetime({ offset: true });
const original = {
  trackId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  sequence: z.number().int().min(0).max(2147483647),
  pcm: z.array(z.number().int().min(-32768).max(32767)).length(160),
  beforeMs: z.number().finite(),
  afterMs: z.number().finite(),
  serverWindow: z.strictObject({ before: instant, after: instant }),
};
const ordered = (value: {
  readonly beforeMs: number;
  readonly afterMs: number;
  readonly serverWindow: { readonly before: string; readonly after: string };
}) =>
  value.beforeMs <= value.afterMs &&
  Date.parse(value.serverWindow.before) <= Date.parse(value.serverWindow.after);
const frame = z
  .strictObject({ ...original, receivedAt: instant })
  .refine(
    (value) =>
      ordered(value) &&
      Date.parse(value.serverWindow.after) <= Date.parse(value.receivedAt),
  );
/** Private ephemeral relay envelope assembled only after authenticated media admission. */
export const botActivityBatchSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  roundParticipantId: idSchema,
  frames: z.array(frame).min(1).max(20),
});
/**
 * Signed worker body: Round comes from the signature, receipt from fresh
 * PostgreSQL time. The segment names the phase the frames belong to; it is
 * checked against the current segment on admission, never trusted.
 */
export const botActivityRelaySchema = z.strictObject({
  version: z.literal(1),
  roundParticipantId: idSchema,
  segmentId: idSchema,
  frames: z.array(z.strictObject(original).refine(ordered)).min(1).max(20),
});
/**
 * Signed worker body: capture subscribed to a bot seat's track and reads it
 * (ISSUE-514-r2). Round comes from the signature; the segment is checked
 * against the current segment on admission, never trusted.
 */
export const botHeardRelaySchema = z.strictObject({
  version: z.literal(1),
  roundParticipantId: idSchema,
  segmentId: idSchema,
  trackId: original.trackId,
});
