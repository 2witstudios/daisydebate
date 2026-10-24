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
  /** Every Round's recent check-in markers: the sampler counts any pending one. */
  checkInAttempts: z.array(
    z.discriminatedUnion('state', [
      z.strictObject({
        state: z.literal('pending'),
        receivedAt: instant,
        resolvedAt: z.null(),
      }),
      z.strictObject({
        state: z.enum(['committed', 'aborted']),
        receivedAt: instant,
        resolvedAt: instant,
      }),
    ]),
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

type Marker = Observation['checkInAttempts'][number];

const SLICE_US = BigInt(attendanceTimingPolicy.transactionSliceMs) * 1_000n;

/** A committed marker its own writer closed: held no longer than the slice. */
const writerClosed = (marker: Marker) =>
  marker.state === 'committed' &&
  elapsedAttendanceObservationUs(marker.resolvedAt, marker.receivedAt) <=
    SLICE_US;

/** Could this marker have been open at `at`? Generous, so it fails closed. */
const couldHold = (marker: Marker, at: string) =>
  elapsedAttendanceObservationUs(at, marker.receivedAt) >= 0n &&
  (marker.resolvedAt === null ||
    elapsedAttendanceObservationUs(at, marker.resolvedAt) <= SLICE_US);

/**
 * ISSUE-541: the sampler reports `check_in_pending` while any check-in
 * marker is open, so a sample can land inside a proof's own replayed
 * check-in. Only the writer's own slice is excused: a committed marker
 * that resolved within the attendance transaction slice (setup through
 * COMMIT), with the sample inside that slice from its receipt, and no
 * other marker that could be holding the sample open. Reconcile settles an
 * orphan only after its backend is gone and records the same state, so a
 * marker held past the slice, an aborted one or one still pending
 * disqualifies the sample, as does any other cause.
 */
export const duringCheckInCommit = (
  sample: Observation['samples'][number],
  markers: readonly Marker[],
) =>
  sample.cause === 'check_in_pending' &&
  markers.some(
    (marker) =>
      writerClosed(marker) &&
      elapsedAttendanceObservationUs(sample.at, marker.receivedAt) >= 0n &&
      elapsedAttendanceObservationUs(sample.at, marker.receivedAt) <= SLICE_US,
  ) &&
  !markers.some(
    (marker) => !writerClosed(marker) && couldHold(marker, sample.at),
  );
