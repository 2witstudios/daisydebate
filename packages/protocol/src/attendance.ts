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

export const attendanceTimingPolicy = {
  heartbeatMs: 15000,
  reconnectBudgetMs: 10000,
  graceMs: 40000,
  leadMs: 5000,
  commitBudgetMs: 2000,
  /**
   * The execution slice of each attendance transaction, setup through
   * COMMIT: a writer opens and closes its check-in marker inside it.
   */
  transactionSliceMs: 900,
  finalizationBufferMs: 5000,
} as const;

/**
 * When availability evidence closes an outage (ADR 0067): after this many
 * consecutive healthy samples, and a gap between samples longer than
 * maxSampleGapMs opens one. So the outage state at any instant is fixed by
 * the latest recoverySamples samples before it, which bounds how much
 * history a later decision must read (ISSUE-529).
 */
export const availabilityRecoveryPolicy = {
  recoverySamples: 3,
  maxSampleGapMs: 2000,
} as const;
