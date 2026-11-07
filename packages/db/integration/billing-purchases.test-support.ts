import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import {
  canManageBilling,
  canPurchasePremium,
} from '@daisy/auth/authorization';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { createLane } from '../src/workload';
import { admitParticipants } from '../src/beta-access-testing';
import {
  createBillingPurchases,
  type BillingPurchasePolicies,
} from '../src/billing-purchase-store';
import { withFlags } from './flags.test-support';
import { requireTestServices } from '@daisy/config';

const { databaseUrl } = requireTestServices(process.env);
export const offer = {
  mode: 'test' as const,
  priceId: 'price_fixture',
  returnOrigin: 'https://daisy.example',
};
type FlagsFixture = Parameters<Parameters<typeof withFlags>[0]>[0];
type Run = ReturnType<typeof createBoundedTransaction>;
export function withBillingPurchases(
  work: (
    input: FlagsFixture & {
      readonly run: Run;
      readonly pool: SQL;
      readonly subject: { readonly userId: string; readonly actorId: string };
      readonly purchases: ReturnType<typeof createBillingPurchases>;
      readonly policies: BillingPurchasePolicies;
    },
  ) => Promise<void>,
) {
  return withFlags(async (flags) => {
    const pool = new SQL(databaseUrl, { max: 6 });
    const run = createBoundedTransaction({
      lane: createLane('control', pool, {
        connections: 6,
        queue: 64,
        maxWaitMs: 1000,
      }),
      now: performance.now,
    });
    await admitParticipants(flags.fixture.sql, [flags.userId]);
    await flags.fixture
      .sql`update users set email_verified=true where id=${flags.userId}`;
    const policies: BillingPurchasePolicies = {
      purchase: canPurchasePremium,
      manage: canManageBilling,
      // A named fixture policy; web integration must prove the real catalogue consumer separately.
      release: {
        keys: [flags.key],
        decide: (snapshot, now) => {
          if (snapshot.kind !== 'available') return false;
          const flag = snapshot.flags.find((entry) => entry.key === flags.key);
          if (!flag || flag.state === 'killed') return false;
          if (flag.override && now < flag.override.expiresAt)
            return flag.override.enabled;
          return flag.state === 'enabled';
        },
      },
    };
    try {
      await work({
        ...flags,
        pool,
        run,
        policies,
        subject: { userId: flags.userId, actorId: flags.actorId },
        purchases: createBillingPurchases({ run, nextId: createId, policies }),
      });
    } finally {
      await pool.close({ timeout: 0 });
      // A pre-migration RED has no table to clean; the test body itself is never skipped.
      const [exists] = await flags.fixture
        .sql`select to_regclass('public.billing_purchases') is not null as present`;
      if (exists!.present)
        await flags.fixture
          .sql`delete from billing_purchases where user_id=${flags.userId}`;
      await flags.fixture
        .sql`delete from billing_subscriptions where user_id=${flags.userId}`;
      await flags.fixture
        .sql`delete from billing_customers where user_id=${flags.userId}`;
    }
  });
}
