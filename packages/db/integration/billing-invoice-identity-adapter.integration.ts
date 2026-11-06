import { repairInvoicePassAuthority } from './billing-invoice-pass-current.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createDatabase } from '../src/index';
import { exportPrivacySubject } from '../src/privacy';
import {
  withBillingRefunds,
  refundRooms,
} from './billing-refunds.test-support';
import { seedInvoicePassPredecessor } from './billing-invoice-pass-predecessor.test-support';

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();
const migration = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);

test('public current-service identity materialization validates exact producer binding, retains before retirement and survives late-fact rotation', async () => {
  await withBillingRefunds(async (input) => {
    const {
      fixture,
      pool,
      userId,
      actorId,
      instanceId,
      vendorCustomerId,
      inbox,
    } = input;
    const ids = await fixture.sql.begin(async (tx) => {
      await tx.unsafe(
        await Bun.file(
          new URL(
            '../migrations/20261106023226_stripe_cleanup_failure_classification/migration.sql',
            import.meta.url,
          ),
        ).text(),
      );
      await tx`set local role daisy_web`;
      await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
      const [job] =
        await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
      const old = await seedInvoicePassPredecessor(
        tx,
        job!.id,
        'unrouted-invoices',
      );
      const frame = old.billing_cleanup.scans.invoices;
      await tx`reset role`;
      await tx.unsafe(await Bun.file(migration).text());
      await repairInvoicePassAuthority(tx);
      return [frame.id, ...frame.rest] as string[];
    });
    const reserve = pool.reserve.bind(pool);
    pool.reserve = async (options) => {
      const connection = await reserve(options);
      await connection`set role daisy_web`;
      return connection;
    };
    const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const cleanup = database.billingCleanup(instanceId);
    const job = async () =>
      (
        await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${userId} and vendor='stripe'`
      )[0]!;
    const claim = async () => {
      const row = await job();
      await fixture.sql`select pg_sleep(greatest(0,extract(epoch from ${row.retry_at}::timestamptz-clock_timestamp()))+.01)`;
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const result = await cleanup.claim(row.id);
      if (
        result.kind !== 'claimed' ||
        result.state.kind === 'acknowledged' ||
        !result.state.claim
      )
        throw Error('Missing controlled current identity claim');
      return {
        ...result,
        claimId: result.state.claim.id,
        jobId: row.id as string,
      };
    };
    try {
      let active = await claim();
      for (
        let step = 0;
        active.work.kind !== 'invoice-identity' && step < 5;
        step++
      ) {
        const [clock] = await fixture.sql`select clock_timestamp() as at`;
        await cleanup.record(active.jobId, {
          kind: 'failure',
          claimId: active.claimId,
          work: active.work,
          retryAt: new Date(clock!.at.getTime() + 1000).toISOString(),
        });
        active = await claim();
      }
      if (active.work.kind !== 'invoice-identity')
        throw Error('Identity debt was not fairly reachable');
      const read = {
        mode: 'test' as const,
        customerId: vendorCustomerId,
        invoiceId: active.work.invoiceId,
        source: {
          kind: 'unresolved' as const,
          vendorSubscriptionId: null,
          priceId: null,
        },
      };
      const before = await job();
      await assertRejects({
        given:
          'an otherwise exact owned invoice read without registered current service',
        should: 'refuse before retention or identity retirement',
        code: 'AUTHORIZATION',
        actual: () =>
          database
            .billingCleanup(createId())
            .retainInvoiceIdentity(
              active.jobId,
              active.claimId,
              active.work,
              read,
            ),
      });
      const refused = await Promise.all([
        cleanup.retainInvoiceIdentity(
          active.jobId,
          active.claimId,
          active.work,
          { ...read, customerId: 'cus_foreign' },
        ),
        cleanup.retainInvoiceIdentity(
          active.jobId,
          active.claimId,
          active.work,
          { ...read, invoiceId: 'in_foreign' },
        ),
        cleanup.retainInvoiceIdentity(
          active.jobId,
          active.claimId,
          active.work,
          { ...read, source: { kind: 'invented' } },
        ),
      ]);
      assert({
        given: 'foreign exact invoice/customer or malformed source',
        should: 'preserve the exact job and debt without creating a witness',
        actual: [
          refused,
          await job(),
          (
            await fixture.sql`select id from billing_payment_observations where user_id=${userId}`
          ).length,
        ],
        expected: [['idle', 'idle', 'idle'], before, 0],
      });
      const result = await cleanup.retainInvoiceIdentity(
        active.jobId,
        active.claimId,
        active.work,
        read,
      );
      const [observation] =
        await fixture.sql`select * from billing_payment_observations where user_id=${userId}`;
      const progressed = await job();
      assert({
        given:
          'a controlled positive exact owned invoice read under a live current claim',
        should:
          'atomically retain the owed witness before retiring only that identity, without financial authority',
        actual: [
          result,
          observation!.vendor_invoice_id,
          observation!.source,
          observation!.state,
          progressed.billing_cleanup.invoiceDebt,
          progressed.billing_cleanup.claim,
        ],
        expected: [
          'progress',
          ids[0],
          read.source,
          { kind: 'owed', reason: 'enumeration_unavailable' },
          { kind: 'owed', ids: ids.slice(1), next: 'observations' },
          null,
        ],
      });
      const replay = await cleanup.retainInvoiceIdentity(
        active.jobId,
        active.claimId,
        active.work,
        read,
      );
      const replayed = await job();
      const event = {
        eventId: `evt_${createId()}`,
        customerId: vendorCustomerId,
        mode: 'test' as const,
      };
      await inbox(event);
      const rotated = await job();
      await inbox(event);
      const stale = await cleanup.retainInvoiceIdentity(
        active.jobId,
        active.claimId,
        active.work,
        read,
      );
      const exported = await exportPrivacySubject(
        drizzle({ client: fixture.sql }),
        { userId, actorId },
        refundRooms,
      );
      assert({
        given:
          'an identical response followed by new closed-account facts and their exact replay',
        should:
          'leave consumed replay idle, rotate once with remaining identity debt, reject old tokens and export only minimal unresolved IDs',
        actual: [
          replay,
          replayed,
          rotated.id !== active.jobId,
          rotated.billing_cleanup.invoiceDebt,
          await job(),
          stale,
          (
            await fixture.sql`select * from billing_payment_observations where user_id=${userId}`
          )[0],
          exported.billing_unrouted_invoices,
        ],
        expected: [
          'idle',
          progressed,
          true,
          { kind: 'owed', ids: ids.slice(1), next: 'identity' },
          rotated,
          'idle',
          observation,
          ids.slice(1).map((vendor_invoice_id) => ({ vendor_invoice_id })),
        ],
      });
    } finally {
      pool.reserve = reserve;
      await fixture.sql`delete from billing_payment_observations where user_id=${userId}`;
    }
  });
}, 25_000);
