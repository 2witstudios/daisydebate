import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { withBillingRefunds } from './billing-refunds.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const read = (customerId: string) => ({
  mode: 'test',
  customerId,
  invoiceId: `in_${createId()}`,
  invoicePaymentId: `inpay_${createId()}`,
  source: { kind: 'unresolved', vendorSubscriptionId: null, priceId: null },
  evidence: {
    kind: 'partial',
    facts: {
      status: null,
      paidAtSeconds: null,
      amountPaidMinor: null,
      charge: { kind: 'unresolved' },
      period: null,
    },
  },
});

// Five head pages plus twenty retained members and the next page require >=26 fixed one-second intervals.
// This budget preserves production cadence; it does not alter claim/service or retry deadlines.
test(
  'actual-role revisit reads the exact selected member beyond page one and fences foreign/stale progress',
  async () =>
    withBillingRefunds(
      async ({ fixture, pool, userId, instanceId, vendorCustomerId }) => {
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
        const supplied = new Map<string, ReturnType<typeof read>>();
        try {
          for (let index = 0; index < 21; index++) {
            const value = read(vendorCustomerId);
            supplied.set(value.invoicePaymentId, value);
            await cleanup.recordPayment(userId, value);
          }
          const [job] =
            await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
          const jobId = String(job!.id);
          const claim = async () => {
            await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
            await database.renewServiceInstance({ instanceId, role: 'web' });
            const result = await cleanup.claim(jobId);
            if (
              result.kind !== 'claimed' ||
              result.state.kind === 'acknowledged' ||
              !result.state.claim
            )
              throw Error('Revisit fixture claim refused');
            return { work: result.work, claimId: result.state.claim.id };
          };
          for (let lane = 0; lane < 4; lane++) {
            const current = await claim();
            const progress =
              current.work.kind === 'scan' && current.work.lane === 'invoices'
                ? await cleanup.retainInvoicePage(
                    jobId,
                    current.claimId,
                    current.work,
                    { reads: [], more: false },
                  )
                : await cleanup.record(jobId, {
                    kind: 'page',
                    ...current,
                    ids: [],
                    more: false,
                  });
            if (progress !== 'progress')
              throw Error('Revisit setup page refused');
          }
          const first = await claim();
          const page = await cleanup.observations(
            jobId,
            first.claimId,
            first.work,
            null,
          );
          if (page.kind !== 'observations')
            throw Error('Missing initial observation page');
          await cleanup.record(jobId, {
            kind: 'page',
            ...first,
            ids: page.observations.map((row) => row.id),
            more: page.more,
          });
          for (let index = 0; index < 20; index++) {
            const current = await claim();
            const selected = await cleanup.selectedObservation(
              jobId,
              current.claimId,
              current.work,
            );
            if (
              selected.kind !== 'observation' ||
              selected.observation.kind !== 'payment'
            )
              throw Error('Missing owned selected payment');
            const before = selected.observation;
            const value = supplied.get(before.invoicePaymentId);
            if (!value) throw Error('Missing controlled original read');
            const retained = await cleanup.revisitPayment(
              jobId,
              current.claimId,
              current.work,
              value,
            );
            const [row] =
              await fixture.sql`select observed_at from billing_payment_observations where id=${before.id}`;
            if (
              retained !== 'progress' ||
              row!.observed_at.toISOString() !== before.observedAt
            )
              throw Error(
                'Unchanged retention refreshed facts or failed to advance',
              );
          }
          const nextPage = await claim();
          if (
            nextPage.work.kind !== 'scan' ||
            nextPage.work.scan.kind !== 'page'
          )
            throw Error('Missing next page frame');
          const tail = await cleanup.observations(
            jobId,
            nextPage.claimId,
            nextPage.work,
            nextPage.work.scan.afterId,
          );
          if (tail.kind !== 'observations' || tail.observations.length !== 1)
            throw Error('Missing exact tail');
          await cleanup.record(jobId, {
            kind: 'page',
            ...nextPage,
            ids: tail.observations.map((row) => row.id),
            more: tail.more,
          });
          const current = await claim();
          const selected = await cleanup.selectedObservation(
            jobId,
            current.claimId,
            current.work,
          );
          if (
            selected.kind !== 'observation' ||
            selected.observation.kind !== 'payment'
          )
            throw Error('Missing selected tail payment');
          const value = supplied.get(selected.observation.invoicePaymentId)!;
          const [before] =
            await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
          const wrongClaim = await cleanup.selectedObservation(
            jobId,
            createId(),
            current.work,
          );
          const foreign = await cleanup.revisitPayment(
            jobId,
            current.claimId,
            current.work,
            { ...value, invoicePaymentId: `inpay_${createId()}` },
          );
          const [unchanged] =
            await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
          const late = read(vendorCustomerId);
          await cleanup.recordPayment(userId, late);
          const [reopened] =
            await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
          const stale = await cleanup.revisitPayment(
            jobId,
            current.claimId,
            current.work,
            value,
          );
          const replay = await cleanup.recordPayment(userId, late);
          const [same] =
            await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
          assert({
            given:
              'a twenty-first owed identity, foreign read and late job rotation after exact selection',
            should:
              'read the tail directly, keep unchanged fact times, refuse foreign/stale consumption and preserve one pending replacement on replay',
            actual: [
              page.observations.length,
              page.more,
              tail.observations[0]!.id === selected.observation.id,
              selected.observation.state.kind,
              wrongClaim.kind,
              foreign,
              unchanged,
              reopened!.id !== jobId,
              reopened!.status,
              stale,
              replay,
              same,
            ],
            expected: [
              20,
              true,
              true,
              'owed',
              'refuse',
              'idle',
              before,
              true,
              'pending',
              'idle',
              'unchanged',
              reopened,
            ],
          });
        } finally {
          pool.reserve = reserve;
          await fixture.sql`delete from billing_payment_observations where user_id=${userId}`;
        }
      },
    ),
  40_000,
);
