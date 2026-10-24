import { z } from 'zod';
import {
  attendanceTimingPolicy,
  idSchema,
  roundStatusSchema,
  segmentTypes,
} from '@daisy/protocol';

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
  /** Every Round's resolved check-in markers: the sampler counts any pending one. */
  checkInAttempts: z.array(
    z.strictObject({
      state: z.enum(['committed', 'aborted']),
      receivedAt: instant,
      resolvedAt: instant,
    }),
  ),
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

type Observation = z.infer<typeof evidence>;

/**
 * ISSUE-541: the sampler reports `check_in_pending` while any check-in
 * marker is open, so a sample can land inside a proof's own replayed
 * check-in commit. Only that is excused: a committed marker that resolved
 * within the commit budget and spans the sample. An orphan, a slow or
 * aborted commit, and every other cause are not.
 */
export const duringCheckInCommit = (
  sample: Observation['samples'][number],
  attempts: Observation['checkInAttempts'],
) =>
  sample.cause === 'check_in_pending' &&
  attempts.some(
    (attempt) =>
      attempt.state === 'committed' &&
      elapsedAttendanceObservationUs(attempt.resolvedAt, attempt.receivedAt) <=
        BigInt(attendanceTimingPolicy.commitBudgetMs) * 1_000n &&
      elapsedAttendanceObservationUs(sample.at, attempt.receivedAt) >= 0n &&
      elapsedAttendanceObservationUs(attempt.resolvedAt, sample.at) >= 0n,
  );
