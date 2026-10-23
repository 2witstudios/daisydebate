import type { SQL } from 'bun';
import type { Database } from '@daisy/db';
import { createId } from '@paralleldrive/cuid2';
import { startAvailabilityService } from '../src/features/availability/service';
import { DEFAULT_BALLOT_DEADLINE_MS } from '../src/features/round-finalization/maintenance';
import { roundTickProjection } from '../src/features/round-finalization/operations';

type WebFinalizerFixture = {
  readonly store: Pick<
    Database,
    'renewServiceInstance' | 'finalizeDueRoundTranscript'
  >;
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
    ) => ReturnType<Database['finalizeDueRoundTranscript']>,
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
        ballotDeadlineMs: DEFAULT_BALLOT_DEADLINE_MS,
      }),
    );
  } finally {
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}
export const finalizeAsWeb = (f: WebFinalizerFixture, roundId: string) =>
  withWebFinalizer(f, (finalize) => finalize(roundId));

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

export const maintenanceTestTimers = {
  setInterval: (pulse: () => void, ms: number) => {
    const handle = setInterval(pulse, ms);
    return () => clearInterval(handle);
  },
  clearInterval: (stop: unknown) => {
    if (typeof stop !== 'function') throw new Error('Unknown test timer');
    stop();
  },
};

/** Observes real elected sampling without replacing its SQL or evidence. */
export function maintenanceAvailability(input: {
  readonly store: Database;
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
    timers: maintenanceTestTimers,
    failed: input.failed,
  });
  return { service, firstSample };
}
