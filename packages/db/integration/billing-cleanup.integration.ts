import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { withBillingRefunds } from './billing-refunds.test-support';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('Stripe cleanup proves free no-mapping closure and atomically completes its exact job without vendor effects', async () =>
  withBillingRefunds(async ({ fixture, pool, instanceId, userId }) => {
    await fixture.sql`delete from billing_customers where user_id=${userId}`;
    const [job] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
    const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const cleanup = database.billingCleanup(instanceId);
    const claimed = await cleanup.claim(job!.id);
    if (
      claimed.kind !== 'claimed' ||
      claimed.state.kind === 'acknowledged' ||
      !claimed.state.claim
    )
      throw Error('Cleanup fixture claim refused');
    const event = {
      kind: 'no-effects' as const,
      claimId: claimed.state.claim.id,
      work: claimed.work,
    };
    const result = await cleanup.record(job!.id, event);
    const [row] =
      await fixture.sql`select id,status,attempts,retry_at,billing_cleanup->>'outcome' as outcome from privacy_jobs where id=${job!.id}`;
    const replay = await cleanup.record(job!.id, event);
    const [same] =
      await fixture.sql`select id,status,attempts,retry_at,billing_cleanup->>'outcome' as outcome from privacy_jobs where id=${job!.id}`;
    assert({
      given:
        'closed free account with positively verified absence of mapping, possible purchase and financial routes',
      should:
        'complete once without inventing vendor deletion or changing retry state on replay',
      actual: [
        claimed.facts,
        result,
        row!.status,
        row!.attempts,
        row!.outcome,
        replay,
        same,
      ],
      expected: [
        {
          effects: {
            mappedCustomers: 0,
            possiblePurchases: 0,
            retainedFinancialRoutes: 0,
            owedFinancialEffects: false,
          },
          route: { kind: 'absent' },
        },
        'complete',
        'succeeded',
        0,
        'no-vendor-effects',
        'idle',
        row,
      ],
    });
  }));
