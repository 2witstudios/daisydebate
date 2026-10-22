import { z } from 'zod';
import { idSchema, roundStatusSchema, segmentTypes } from '@daisy/protocol';

const instant = z.iso.datetime({ precision: 6 });
const viewOrNativeInstant = z.union([
  instant,
  z.iso.datetime({ precision: 3 }),
]);
const observationUs = (value: string) => {
  const parsed = viewOrNativeInstant.parse(value);
  const fraction = parsed.slice(parsed.indexOf('.') + 1, -1).padEnd(6, '0');
  return BigInt(Date.parse(parsed)) * 1_000n + BigInt(fraction.slice(3));
};

/** Compare observations only; competitive timing remains inside the PG adapter. */
export const elapsedAttendanceObservationUs = (
  later: string,
  earlier: string,
) => observationUs(later) - observationUs(earlier);

const count = z.int().nonnegative();
const sample = z
  .strictObject({
    at: instant,
    healthy: z.boolean(),
    cause: z
      .enum([
        'web_stale',
        'realtime_stale',
        'delivery_lag',
        'public_probe_failed',
        'check_in_pending',
      ])
      .nullable(),
  })
  .refine((value) => value.healthy === (value.cause === null));
const evidence = z.strictObject({
  roundId: idSchema,
  observedAt: instant,
  status: roundStatusSchema,
  version: z.int().positive(),
  pendingAttempts: count,
  ratingChanges: count,
  checkInCommands: count,
  samples: z.array(sample),
  instances: z.array(
    z.strictObject({
      instanceId: idSchema,
      role: z.enum(['web', 'realtime']),
      renewedAt: instant,
      deliveredThrough: z.string().regex(/^\d+$/).nullable(),
      deliveredThroughTxid: z.string().regex(/^\d+$/).nullable(),
    }),
  ),
  segments: z.array(
    z.strictObject({
      id: idSchema,
      type: z.enum(segmentTypes),
      startedAt: instant,
      endedAt: instant.nullable(),
    }),
  ),
  receipts: z.array(
    z.strictObject({
      commandId: idSchema,
      segmentId: idSchema,
      participantId: idSchema,
      receivedAt: instant,
    }),
  ),
  adjudications: z.array(
    z.strictObject({
      segmentId: idSchema,
      commandId: idSchema,
      decision: z.enum(['attended', 'none', 'forfeit', 'abandoned']),
      effectiveDeadline: instant,
      settledHorizon: instant,
      appliedAt: instant,
    }),
  ),
});

/** A scoped observation, never an input to competitive decisions or a healthy default. */
export function decodeAttendanceEvidence(stdout: string, roundId: string) {
  try {
    const result = evidence.parse(JSON.parse(stdout));
    if (result.roundId !== roundId) throw new Error('Foreign observation');
    return result;
  } catch {
    throw new Error('Invalid attendance evidence payload');
  }
}
