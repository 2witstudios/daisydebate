import type { AvailabilityStore } from '@daisy/db/stores/availability';
import type { RoundMaintenanceStore } from '@daisy/db/stores/round-maintenance';
import type { AttendanceStore } from '@daisy/db/stores/attendance';
import { hostWaits } from '@daisy/worker/host';
import { botGrantUnused, captureRule } from '@daisy/debate-engine';
import { judgingPolicy } from '@daisy/protocol/judging-policy';
import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { startAvailabilityService } from '../src/features/availability/service';
import {
  createRoundMaintenanceOperations,
  judgingPlan,
} from '../src/features/round-finalization/maintenance';
import { roundTickProjection } from '../src/features/round-finalization/operations';

type WebFinalizerFixture = {
  readonly store: Pick<AvailabilityStore, 'renewServiceInstance'> &
    Pick<RoundMaintenanceStore, 'finalizeDueRoundTranscript'>;
  readonly sql: SQL;
};
/**
 * The production finalizer under a fresh web instance lease and the Round
 * lock; the lease row is removed afterwards. Take the lease before a race so
 * the finalizer queues for the lock when the work calls it.
 */
export async function withWebFinalizer<T>(
  f: WebFinalizerFixture,
  work: (
    finalize: (
      roundId: string,
    ) => ReturnType<RoundMaintenanceStore['finalizeDueRoundTranscript']>,
  ) => Promise<T>,
) {
  const instanceId = createId();
  await f.store.renewServiceInstance({ instanceId, role: 'web' });
  try {
    return await work((roundId) =>
      f.store.finalizeDueRoundTranscript({
        instanceId,
        roundId,
        buildProjection: roundTickProjection(createId),
        botGrantUnused,
        captureRule,
        planJudging: judgingPlan(judgingPolicy.humanBallotWindowMs),
      }),
    );
  } finally {
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}
export const finalizeAsWeb = (f: WebFinalizerFixture, roundId: string) =>
  withWebFinalizer(f, (finalize) => finalize(roundId));

/** The production maintenance finalize, with no AI evaluation, under a fresh web lease. */
/** One web instance's maintenance with no probe Round and no attendance evaluator. */
export const ordinaryMaintenance = (
  store: Parameters<typeof createRoundMaintenanceOperations>[0]['store'],
  instanceId: string,
) =>
  createRoundMaintenanceOperations({
    ratingFailed: (_id, error) => {
      throw error;
    },
    probeRoundId: null,
    store,
    instanceId,
    ids: { next: createId },
    evaluate: async () => ({ kind: 'undecided' as const }),
  });

export async function finalizeByMaintenance(
  f: {
    readonly store: Parameters<
      typeof createRoundMaintenanceOperations
    >[0]['store'] &
      WebFinalizerFixture['store'];
    readonly sql: SQL;
  },
  roundId: string,
) {
  const instanceId = createId();
  await f.store.renewServiceInstance({ instanceId, role: 'web' });
  try {
    await ordinaryMaintenance(f.store, instanceId).finalize(roundId);
  } finally {
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}

/**
 * Test clock for the persisted ballot deadline: PostgreSQL time cannot be
 * injected and the deadline is immutable, so move it into the past in one
 * transaction that bypasses only user triggers.
 */
export const passBallotDeadline = (sql: SQL, roundId: string) =>
  sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update rounds set ballot_deadline_at=clock_timestamp()-interval '1 millisecond' where id=${roundId}`;
  });

/** Observes real elected sampling without replacing its SQL or evidence. */
export function maintenanceAvailability(input: {
  readonly store: AttendanceStore & AvailabilityStore & RoundMaintenanceStore;
  readonly instanceId: string;
  readonly stamps: string[];
  readonly failed: () => void;
}) {
  let sampled!: () => void;
  const firstSample = new Promise<void>((resolve) => {
    sampled = resolve;
  });
  const sampler = input.store.availabilitySampler();
  const service = startAvailabilityService({
    nowMs: () => performance.now(),
    instanceId: input.instanceId,
    store: {
      ...input.store,
      availabilitySampler: () => ({
        ...sampler,
        sample: async (evidence) => {
          const row = await sampler.sample(evidence);
          if (row) input.stamps.push(row.at);
          sampled();
          return row;
        },
      }),
    },
    probe: async () => false,
    waits: hostWaits,
    failed: input.failed,
    lapsing: { log: () => {}, report: () => {} },
    nextId: () => input.instanceId,
  });
  return { service, firstSample };
}
