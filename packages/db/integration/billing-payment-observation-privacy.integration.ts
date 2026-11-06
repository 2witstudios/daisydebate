import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createDatabase } from '../src/index';
import { exportPrivacySubject } from '../src/privacy';
import { sqlStateOf } from './constraint-helpers';
import {
  withBillingRefunds,
  refundRooms,
} from './billing-refunds.test-support';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();
type Fixture = Parameters<Parameters<typeof withBillingRefunds>[0]>[0];
async function witness(input: Fixture) {
  const id = createId();
  await input.fixture
    .sql`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
    insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,source,state,closed_at,created_at,observed_at)
    select ${id},id,'test',${input.vendorCustomerId},${`in_${createId()}`},'invoice',
      '{"kind":"unresolved","vendorSubscriptionId":null,"priceId":null}'::jsonb,
      '{"kind":"owed","reason":"enumeration_unavailable"}'::jsonb,date_trunc('milliseconds',deleted_at),sampled.at,sampled.at
      from users cross join sampled where id=${input.userId}`;
  return id;
}

test('observation-only routing survives customer deletion and late facts, blocks empty-effect acknowledgement and exports only its subject facts', async () =>
  withBillingRefunds(async (input) =>
    withBillingRefunds(async (other) => {
      const {
        fixture,
        userId,
        actorId,
        pool,
        instanceId,
        vendorCustomerId,
        inbox,
      } = input;
      const id = await witness(input),
        foreignId = await witness(other);
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      try {
        await fixture.sql`delete from billing_customers where user_id=${userId}`;
        // A prior queue acknowledgement is a fixture, never proof that absence resolved this observation.
        await fixture.sql`update privacy_jobs set status='succeeded',succeeded_at=clock_timestamp() where subject_ref=${userId} and vendor='stripe'`;
        const [oldJob] =
          await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const event = {
          eventId: `evt_${createId()}`,
          customerId: vendorCustomerId,
          mode: 'test' as const,
        };
        const first = await inbox(event),
          duplicate = await inbox(event);
        const [job] =
          await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const database = createDatabase({
          url: databaseUrl,
          client: pool,
          nextActorId: createId,
        });
        await database.renewServiceInstance({ instanceId, role: 'web' });
        const cleanup = database.billingCleanup(instanceId),
          claim = await cleanup.claim(job!.id);
        if (
          claim.kind !== 'claimed' ||
          claim.state.kind === 'acknowledged' ||
          !claim.state.claim
        )
          throw Error('Missing observation-only cleanup claim');
        const before = (
          await fixture.sql`select billing_cleanup,retry_at,attempts,status from privacy_jobs where id=${job!.id}`
        )[0];
        const result = await cleanup.record(job!.id, {
          kind: 'no-effects',
          claimId: claim.state.claim.id,
          work: claim.work,
        });
        const exported = await exportPrivacySubject(
          drizzle({ client: fixture.sql }),
          { userId, actorId },
          refundRooms,
        );
        const observations = exported.billing_payment_observations!;
        assert({
          given:
            'two closed subjects and one invoice-only unknown remaining after ordinary customer deletion',
          should:
            'retain owned routing, rearm only on new facts, refuse zero-effect relief and export no foreign facts or execution token',
          actual: [
            first,
            duplicate,
            job!.id !== oldJob!.id,
            job!.status,
            claim.facts.route,
            claim.facts.effects.retainedFinancialRoutes,
            result,
            (
              await fixture.sql`select billing_cleanup,retry_at,attempts,status from privacy_jobs where id=${job!.id}`
            )[0],
            observations.map((row) => [
              row.id,
              row.kind,
              row.vendor_invoice_payment_id,
              row.refund_action_id,
              row.state,
            ]),
            JSON.stringify(observations).includes(foreignId),
            JSON.stringify(observations).includes(claim.state.claim.id),
            (
              await fixture.sql`select count(*)::int as n from billing_customers where user_id=${userId}`
            )[0]!.n,
          ],
          expected: [
            'closed',
            'duplicate',
            true,
            'pending',
            { kind: 'owned', mode: 'test', customerId: vendorCustomerId },
            1,
            'idle',
            before,
            [
              [
                id,
                'invoice',
                null,
                null,
                { kind: 'owed', reason: 'enumeration_unavailable' },
              ],
            ],
            false,
            false,
            0,
          ],
        });
        const raw = await fixture.sql.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
          const [clock] =
            await tx`select date_trunc('milliseconds',clock_timestamp()) as at`;
          const checkedAt = clock!.at.toISOString();
          const acknowledged = {
            kind: 'acknowledged',
            outcome: 'no-vendor-effects',
            jobId: job!.id,
            checkedAt,
            nextAt: new Date(clock!.at.getTime() + 86_400_000).toISOString(),
          };
          await tx`savepoint observation_completion_probe`;
          const code = await sqlStateOf(
            () =>
              tx`update privacy_jobs set billing_cleanup=${JSON.stringify(acknowledged)}::text::jsonb,status='succeeded',succeeded_at=${checkedAt}::timestamptz where id=${job!.id}`,
          );
          await tx`rollback to savepoint observation_completion_probe`;
          await tx`release savepoint observation_completion_probe`;
          return code;
        });
        assert({
          given:
            'the same live claim with only an owed invoice observation remaining and no customer, purchase or refund rows',
          should:
            'also refuse raw daisy_web no-vendor-effects acknowledgement and preserve the owed job',
          actual: [
            raw,
            (
              await fixture.sql`select billing_cleanup,retry_at,attempts,status from privacy_jobs where id=${job!.id}`
            )[0],
          ],
          expected: ['23514', before],
        });
      } finally {
        pool.reserve = reserve;
        await fixture.sql`delete from billing_payment_observations where user_id=${userId}`;
        await other.fixture
          .sql`delete from billing_payment_observations where user_id=${other.userId}`;
      }
    }),
  ));
