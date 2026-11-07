import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { invoicePassSchema } from '@daisy/protocol/billing';
import { createInvoicePassReader } from '../src/features/billing/invoice-pass-reader';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('incomplete owned payment HEAD facts enter the real fenced intake once without invoice authority or invented money proof', async () => {
  const owner = new SQL(databaseUrl, { max: 1 }),
    pool = new SQL(databaseUrl, { max: 4 });
  const userId = createId(),
    actorId = createId(),
    customerRecord = createId(),
    customerId = `cus_${customerRecord}`,
    invoiceId = `in_${createId()}`,
    paymentId = `inpay_${createId()}`,
    instanceId = createId(),
    jobId = createId();
  const roles = new Set<string>(),
    reserve = pool.reserve.bind(pool);
  pool.reserve = async (options) => {
    const connection = await reserve(options);
    await connection`set role daisy_web`;
    const [role] = await connection`select current_user as role`;
    roles.add(role!.role);
    return connection;
  };
  const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    }),
    store = database.billingCleanup(instanceId);
  try {
    const [clock] =
      await owner`select date_trunc('milliseconds',clock_timestamp()) as at`;
    const at = clock!.at as Date,
      closedAt = new Date(at.getTime() - 2000).toISOString();
    await owner`insert into users(id,username,created_at,deleted_at) values(${userId},${userId},${new Date(at.getTime() - 60000)},${closedAt})`;
    await owner`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
    await owner`insert into billing_customers(id,user_id,vendor_customer_id,mode,created_at,closed_at,synchronization) values(${customerRecord},${userId},${customerId},'test',${new Date(at.getTime() - 60000)},${closedAt},${JSON.stringify({ kind: 'settled', revision: 1, observedAt: at.toISOString(), nextAt: at.toISOString() })}::text::jsonb)`;
    await owner`insert into privacy_jobs(id,subject_ref,vendor,created_at,retry_at) values(${jobId},${userId},'stripe',${at},${at})`;
    await database.renewServiceInstance({ instanceId, role: 'web' });
    const pass = invoicePassSchema.parse({
      id: createId(),
      jobId,
      beganAt: at.toISOString(),
      owner: {
        mode: 'test',
        customerId,
        invoiceId,
        userId,
        closedAt,
        source: {
          kind: 'unresolved',
          vendorSubscriptionId: null,
          priceId: null,
        },
        period: null,
      },
      phase: 'verify-head',
      afterId: null,
      comparison: { kind: 'bounded', reads: [] },
    });
    const reader = createInvoicePassReader({
      mode: 'test',
      clock: systemClock,
      port: {
        invoice: async () => {
          throw Error('Unexpected invoice call');
        },
        payments: async () => ({
          object: 'list',
          has_more: false,
          data: [
            {
              id: paymentId,
              object: 'invoice_payment',
              livemode: false,
              invoice: {
                id: invoiceId,
                object: 'invoice',
                customer: customerId,
                livemode: false,
              },
              status: 'paid',
              amount_paid: 1000,
              status_transitions: { paid_at: Math.floor(at.getTime() / 1000) },
            },
            { id: 'inpay_incomplete' },
          ],
        }),
      },
    });
    const read = await reader(pass, createId());
    if (read.kind !== 'incomplete')
      throw Error('Missing owned partial HEAD facts');
    const result = await store.recordPayments(userId, read.reads);
    const [row] =
      await owner`select to_jsonb(observation) as value from billing_payment_observations observation where user_id=${userId}`;
    const [job] =
      await owner`select to_jsonb(job) as value from privacy_jobs job where subject_ref=${userId} and vendor='stripe'`;
    const replay = await store.recordPayments(userId, read.reads);
    assert({
      given:
        'the actual reader mixed response, no frozen purchase money authority and the real current daisy_web intake',
      should:
        'retain positive identity/status without charge/allocation invention, rotate once and replay byte-identically without cursor or ACK relief',
      actual: [
        read.reads.length,
        result,
        replay,
        row!.value.state.kind,
        row!.value.state.reason,
        row!.value.state.evidence.kind,
        row!.value.source.kind,
        job!.value.id !== jobId,
        job!.value.status,
        job!.value.billing_cleanup,
        (
          await owner`select to_jsonb(observation) as value from billing_payment_observations observation where user_id=${userId}`
        )[0]!.value,
        (
          await owner`select to_jsonb(job) as value from privacy_jobs job where subject_ref=${userId} and vendor='stripe'`
        )[0]!.value,
        (
          await owner`select count(*)::int as n from billing_refund_actions where user_id=${userId}`
        )[0]!.n,
        [...roles],
      ],
      expected: [
        1,
        'recorded',
        'unchanged',
        'owed',
        'payment_unresolved',
        'partial',
        'unresolved',
        true,
        'pending',
        null,
        row!.value,
        job!.value,
        0,
        ['daisy_web'],
      ],
    });
    let foreign: string | null = null;
    try {
      await store.recordPayments(
        userId,
        read.reads.map((value) => ({ ...value, customerId: 'cus_foreign' })),
      );
    } catch (error) {
      foreign = (error as { code?: string }).code ?? null;
    }
    assert({
      given: 'foreign routing in a later otherwise typed read',
      should:
        'refuse before mutations and preserve both observed facts and exact job',
      actual: [
        foreign,
        (
          await owner`select to_jsonb(observation) as value from billing_payment_observations observation where user_id=${userId}`
        )[0]!.value,
        (
          await owner`select to_jsonb(job) as value from privacy_jobs job where subject_ref=${userId} and vendor='stripe'`
        )[0]!.value,
      ],
      expected: ['AUTHORIZATION', row!.value, job!.value],
    });
    await owner`delete from service_instances where instance_id=${instanceId}`;
    let stale: string | null = null;
    try {
      await store.recordPayments(userId, read.reads);
    } catch (error) {
      stale = (error as { code?: string }).code ?? null;
    }
    assert({
      given: 'lost current service authority after the response',
      should:
        'refuse the intake without refreshing knowledge or the replacement job',
      actual: [
        stale,
        (
          await owner`select to_jsonb(observation) as value from billing_payment_observations observation where user_id=${userId}`
        )[0]!.value,
        (
          await owner`select to_jsonb(job) as value from privacy_jobs job where subject_ref=${userId} and vendor='stripe'`
        )[0]!.value,
      ],
      expected: ['AUTHORIZATION', row!.value, job!.value],
    });
  } finally {
    await owner`delete from billing_payment_observations where user_id=${userId}`;
    await owner`delete from privacy_jobs where subject_ref=${userId}`;
    await owner`delete from billing_customers where user_id=${userId}`;
    await owner`delete from service_instances where instance_id=${instanceId}`;
    await owner`delete from actors where id=${actorId}`;
    await owner`delete from users where id=${userId}`;
    await pool.close({ timeout: 0 });
    await owner.close();
  }
});
