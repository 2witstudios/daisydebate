import { z } from 'zod';
import { idSchema } from './primitives';
/** Actor/service identity is always bound server-side; no identity field is accepted. */
export const attendanceEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  segmentId: idSchema,
});
export type AttendanceEnvelope = z.infer<typeof attendanceEnvelopeSchema>;
export const attendanceReceiptSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  roundId: idSchema,
  segmentId: idSchema,
  participantId: idSchema,
  receivedAt: z.iso.datetime(),
  resultingVersion: z.int().positive(),
  replayed: z.boolean(),
});
export type AttendanceReceipt = z.infer<typeof attendanceReceiptSchema>;
