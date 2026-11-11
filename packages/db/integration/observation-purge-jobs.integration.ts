import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import {
  deliverObservationPurges,
  owedObservationPurges,
  queueObservationPurge,
} from '../src/observation-purge-jobs';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const jobOf = async (client: SQL, userId: string) =>
  (
    await client.unsafe(
      `select status, attempts, retry_at as "retryAt", succeeded_at as "succeededAt"
       from observation_purge_jobs where user_id=$1`,
      [userId],
    )
  )[0] as
    | {
        status: string;
        attempts: number;
        retryAt: Date;
        succeededAt: Date | null;
      }
    | undefined;

test('an erasure queues a durable observation purge that survives a Redis outage and succeeds only after a confirmed purge (ISSUE-852)', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  try {
    const owedBefore = await owedObservationPurges(database);
    // The member's erasure (same messaging adopter path) queues the job.
    await fixture.eraseSubject(fixture.actorId);
    const owedOnceQueued = await owedObservationPurges(database);
    const queued = await jobOf(client, fixture.userId);
    const queuedAt = queued?.retryAt.toISOString() ?? '';
    let purges = 0;
    const outage = await deliverObservationPurges(
      database,
      { now: queuedAt, limit: 16 },
      {
        purge: async () => {
          purges++;
          throw new Error('Redis unavailable');
        },
      },
    );
    const afterOutage = await jobOf(client, fixture.userId);
    const owedInBackoff = await owedObservationPurges(database);
    const early = await deliverObservationPurges(
      database,
      { now: queuedAt, limit: 16 },
      {
        purge: async () => {
          purges++;
        },
      },
    );
    const retryAt = afterOutage?.retryAt.toISOString() ?? '';
    const confirmed = await deliverObservationPurges(
      database,
      { now: retryAt, limit: 16 },
      {
        purge: async () => {
          purges++;
        },
      },
    );
    const done = await jobOf(client, fixture.userId);
    const owedAfterDelivery = await owedObservationPurges(database);
    const idle = await deliverObservationPurges(
      database,
      {
        now: new Date(Date.parse(retryAt) + 3_600_000).toISOString(),
        limit: 16,
      },
      {
        purge: async () => {
          purges++;
        },
      },
    );
    assert({
      given:
        'an erasure, a Redis outage, a retry before the backoff, then a confirmed purge',
      should:
        'queue one pending job in the erasure, keep it pending with backoff through the outage, skip it until due, then record success, and never purge for a finished job',
      actual: {
        queued: queued?.status,
        outage,
        afterOutage: [afterOutage?.status, afterOutage?.attempts],
        backedOff: Date.parse(retryAt) - Date.parse(queuedAt) >= 1_000,
        early,
        confirmed,
        done: [done?.status, done?.attempts, done?.succeededAt !== null],
        idle,
        purges,
        owedBeforeAnyAttempt: owedOnceQueued - owedBefore,
        owedWhileRetrying: owedInBackoff - owedAfterDelivery,
      },
      expected: {
        queued: 'pending',
        outage: { succeeded: 0, retried: 1 },
        afterOutage: ['pending', 1],
        backedOff: true,
        early: { succeeded: 0, retried: 0 },
        confirmed: { succeeded: 1, retried: 0 },
        done: ['succeeded', 2, true],
        idle: { succeeded: 0, retried: 0 },
        purges: 2,
        owedBeforeAnyAttempt: 1,
        owedWhileRetrying: 1,
      },
    });
    // A later erasure of the same member re-arms the obligation.
    await database.transaction((tx) =>
      queueObservationPurge(
        tx,
        fixture.userId,
        new Date(Date.parse(retryAt) + 60_000).toISOString(),
      ),
    );
    assert({
      given: 'a new erasure after a succeeded purge',
      should: 'make the purge pending again',
      actual: (await jobOf(client, fixture.userId))?.status,
      expected: 'pending',
    });
  } finally {
    await client.unsafe(
      'delete from observation_purge_jobs where user_id in ($1,$2)',
      [fixture.userId, fixture.otherUserId],
    );
    await fixture.cleanup();
    await client.close();
  }
});

test('two runners failing the same observation purge count it once', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  try {
    await fixture.eraseSubject(fixture.actorId);
    const queuedAt =
      (await jobOf(client, fixture.userId))?.retryAt.toISOString() ?? '';
    // Both runners have read the due jobs before either purge fails.
    let reading = 0;
    let bothRead!: () => void;
    const together = new Promise<void>((resolve) => (bothRead = resolve));
    const failing = () =>
      deliverObservationPurges(
        database,
        { now: queuedAt, limit: 16 },
        {
          purge: async () => {
            if (++reading === 2) bothRead();
            await together;
            throw new Error('Redis unavailable');
          },
        },
      );
    await Promise.all([failing(), failing()]);
    const job = await jobOf(client, fixture.userId);
    assert({
      given: 'two runners that read one pending purge and both fail it',
      should: 'count one attempt and keep the purge pending',
      actual: [job?.status, job?.attempts],
      expected: ['pending', 1],
    });
  } finally {
    await client.unsafe(
      'delete from observation_purge_jobs where user_id in ($1,$2)',
      [fixture.userId, fixture.otherUserId],
    );
    await fixture.cleanup();
    await client.close();
  }
});
