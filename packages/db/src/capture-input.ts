import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';

const leaseFields = {
  roundId: idSchema,
  sessionId: idSchema,
  workerId: idSchema,
};
const streamFields = {
  ...leaseFields,
  epoch: z.number().int().positive().max(2147483647),
  segmentId: idSchema,
  roundParticipantId: idSchema,
};
export const captureWorkerIdentitySchema = z
  .object({
    ...leaseFields,
    epoch: z.number().int().positive().max(2147483647),
  })
  .strict();
export const captureLeaseCheckSchema = captureWorkerIdentitySchema.safeExtend({
  segmentId: idSchema,
});
export const captureReadSchema = captureWorkerIdentitySchema
  .safeExtend({
    segmentId: idSchema.optional(),
    expectedVersion: z.number().int().nonnegative().max(2147483647).optional(),
    afterIntervalId: idSchema.optional(),
  })
  .refine(
    (value) =>
      !value.afterIntervalId ||
      (value.expectedVersion !== undefined && value.segmentId !== undefined),
  );
export const captureLeaseSchema = z
  .object({
    ...leaseFields,
    leaseMs: z.number().int().min(1000).max(30000),
    expectedEpoch: z.number().int().positive().max(2147483647).optional(),
  })
  .strict();
const trackId = z.string().min(1).max(128);
const iso = z.iso.datetime({ precision: 3 });
export const captureClipSchema = z
  .object({
    ...streamFields,
    trackId,
    startOffsetMs: z.number().int().nonnegative(),
    durationMs: z.number().int().min(1).max(60000),
    text: z
      .string()
      .min(1)
      .max(20000)
      .refine((value) => value.trim().length > 0),
    before: iso,
    after: iso,
  })
  .strict();
export const captureObservationSchema = z
  .object({ ...streamFields, trackId, observedFrom: iso, observedUntil: iso })
  .strict();
export const captureSealSchema = z
  .object({
    ...streamFields,
    expectedChunkCount: z.number().int().nonnegative(),
  })
  .strict();
export function parseCapture<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw createAppError('VALIDATION', 'Invalid capture input');
  return result.data;
}
export const captureDigest = (fields: readonly unknown[]) =>
  new Bun.CryptoHasher('sha3-256').update(JSON.stringify(fields)).digest('hex');
