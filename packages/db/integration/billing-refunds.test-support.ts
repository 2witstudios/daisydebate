import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createDatabase } from '../src/index';
import { erasePrivacySubject } from '../src/privacy';
import { bindings } from './privacy.test-support';
import { withBillingSynchronization } from './billing-synchronization.test-support';

const { databaseUrl } = requireTestServices(process.env);
export const refundRooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};
type Fixture = Parameters<Parameters<typeof withBillingSynchronization>[0]>[0];
type RefundFixture = Fixture & {
  readonly instanceId: string;
  readonly refunds: ReturnType<
    ReturnType<typeof createDatabase>['billingRefunds']
  >;
  readonly payment: {
    readonly customerId: string;
    readonly chargeId: string;
    readonly invoiceId: string;
    readonly vendorSubscriptionId: string;
    readonly mode: 'test';
    readonly currency: 'usd';
    readonly amountMinor: number;
    readonly paidAtSeconds: number;
    readonly period: { readonly startsAt: string; readonly endsAt: string };
  };
};

export function withBillingRefunds(
  work: (input: RefundFixture) => Promise<void>,
) {
  return withBillingSynchronization(async (input) => {
    const { fixture, pool, userId, actorId, vendorCustomerId, subscriptionId } =
      input;
    const [clock] = await fixture.sql`select clock_timestamp() as now`;
    const now = clock!.now as Date;
    // The fixture models completed local closure before verified vendor payment.
    await fixture.sql`update users set created_at=${new Date(now.getTime() - 60_000)} where id=${userId}`;
    await erasePrivacySubject(
      drizzle({ client: fixture.sql }),
      {
        subject: { userId, actorId },
        now: new Date(now.getTime() - 2_000).toISOString(),
        vendors: ['stripe'],
        jobIds: [createId()],
      },
      refundRooms,
      bindings,
    );
    const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const instanceId = createId();
    try {
      await database.renewServiceInstance({ instanceId, role: 'web' });
      await work({
        ...input,
        instanceId,
        refunds: database.billingRefunds(instanceId),
        payment: {
          customerId: vendorCustomerId,
          chargeId: `ch_${createId()}`,
          invoiceId: `in_${subscriptionId}`,
          vendorSubscriptionId: `sub_${subscriptionId}`,
          mode: 'test',
          currency: 'usd',
          amountMinor: 1000,
          paidAtSeconds: Math.floor(now.getTime() / 1000),
          period: {
            startsAt: new Date(now.getTime() - 86_400_000).toISOString(),
            endsAt: new Date(now.getTime() + 29 * 86_400_000).toISOString(),
          },
        },
      });
    } finally {
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      await fixture.sql`delete from billing_refund_actions where user_id=${userId}`;
    }
  });
}

/** A real short claim exercises post-wait expiry without a 30-second wall-clock test. */
export async function shortRefundClaim(input: RefundFixture, id: string) {
  const claimId = createId();
  await input.fixture
    .sql`with sampled as materialized (select clock_timestamp() as at)
    update billing_refund_actions set
    state=jsonb_build_object('kind','unknown','startedAt',to_char(sampled.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'retryAt',to_char(sampled.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'afterRefundId',null),
    claim=jsonb_build_object('id',${claimId}::text,'work','create',
      'claimedAt',to_char(sampled.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt',to_char((sampled.at+interval '500 milliseconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    from sampled where id=${id}`;
  return claimId;
}
