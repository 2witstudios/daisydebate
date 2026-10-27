import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * Signed media-worker body: capture subscribed to a seat's track and reads it
 * (DEC-226, ISSUE-514-r2). Round comes from the signature; the segment is
 * checked against the current segment on admission, never trusted.
 */
export const captureHeardReportSchema = z.strictObject({
  version: z.literal(1),
  roundParticipantId: idSchema,
  segmentId: idSchema,
  trackId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});
