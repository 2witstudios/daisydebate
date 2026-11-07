import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createDatabase } from '../src/index';
import type { createBillingCleanup } from '../src/billing-cleanup';
import { erasePrivacySubject } from '../src/privacy';
import { bindings } from './privacy.test-support';
import { refundRooms } from './billing-refunds.test-support';
import { flagCommand } from './flags.test-support';
import { offer, withBillingPurchases } from './billing-purchases.test-support';

type Fixture = Parameters<Parameters<typeof withBillingPurchases>[0]>[0];
type CleanupFixture = Fixture & {
  readonly cleanup: ReturnType<typeof createBillingCleanup>;
  readonly instanceId: string;
  readonly renew: () => Promise<unknown>;
  readonly jobId: string;
  readonly session: {
    readonly kind: 'complete';
    readonly id: string;
    readonly customerId: string;
    readonly subscriptionId: string;
  };
};
export function withClosedPurchase(
  complete: boolean,
  work: (input: CleanupFixture) => Promise<void>,
) {
  return withBillingPurchases(async (input) => {
    const { fixture, pool, purchases, subject, store, key } = input;
    await store.runFlagCommand(flagCommand(key, 0));
    const admitted = await purchases.admit(subject, offer);
    await purchases.recover(subject, admitted.purchase.id);
    const session = {
      kind: 'complete' as const,
      id: `cs_test_${createId()}`,
      customerId: `cus_${createId()}`,
      subscriptionId: `sub_${createId()}`,
    };
    if (complete)
      await purchases.record(subject, admitted.purchase.id, {
        kind: 'observe',
        session,
      });
    const jobId = createId(),
      instanceId = createId();
    const [clock] = await fixture.sql`select clock_timestamp() as at`;
    await erasePrivacySubject(
      drizzle({ client: fixture.sql }),
      {
        subject,
        now: clock!.at.toISOString(),
        vendors: ['stripe'],
        jobIds: [jobId],
      },
      refundRooms,
      bindings,
    );
    const reserve = pool.reserve.bind(pool);
    pool.reserve = async (options) => {
      const connection = await reserve(options);
      await connection`set role daisy_web`;
      return connection;
    };
    const database = createDatabase({
      url: process.env.TEST_DATABASE_URL!,
      client: pool,
      nextActorId: createId,
    });
    try {
      await database.renewServiceInstance({ instanceId, role: 'web' });
      await work({
        ...input,
        instanceId,
        renew: () => database.renewServiceInstance({ instanceId, role: 'web' }),
        jobId,
        session,
        cleanup: database.billingCleanup(instanceId),
      });
    } finally {
      pool.reserve = reserve;
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      await fixture.sql`delete from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
    }
  });
}
