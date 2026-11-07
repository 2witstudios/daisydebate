import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { advanceCleanup, cleanupWork } from '@daisy/protocol/billing';
import { finishedOrBlockedBehind } from '../src/testing';
import { withSelectedInvoice } from './billing-invoice-retention.test-support';
requireTestServices(process.env);
setupRitewayBun();

test(
  'invoice write wait crossing claim expiry rolls back retained witness and exact cursor',
  async () =>
    withSelectedInvoice(
      async ({ fixture, subject, cleanup, jobId, current, read, claim }) => {
        const originalRows =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId} order by id`;
        const [clock] = await fixture.sql`select clock_timestamp() as at`;
        await cleanup.record(jobId, {
          kind: 'failure',
          claimId: current.claimId,
          work: current.work,
          retryAt: new Date(clock!.at.getTime() + 100).toISOString(),
        });
        // Failure yields the observation lane; consume its exact already-durable row before returning to invoices.
        const yielded = await claim();
        if (
          yielded.work.kind !== 'scan' ||
          yielded.work.lane !== 'observations' ||
          (await cleanup.retainObservation(
            jobId,
            yielded.claimId,
            yielded.work,
          )) !== 'progress'
        )
          throw Error('Missing fair observation turn');
        await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
        const [row] =
          await fixture.sql`select billing_cleanup,clock_timestamp() as at from privacy_jobs where id=${jobId}`;
        const claimed = advanceCleanup(
          row!.billing_cleanup,
          { kind: 'claim', claimId: createId() },
          { jobId, now: row!.at.toISOString(), closed: true },
        );
        if (
          claimed.kind !== 'claimed' ||
          claimed.state.kind !== 'scanning' ||
          !claimed.state.claim
        )
          throw Error('Missing short initial claim');
        claimed.state.claim.expiresAt = new Date(
          Date.parse(claimed.state.claim.claimedAt) + 700,
        ).toISOString();
        await fixture.sql`update privacy_jobs set billing_cleanup=${JSON.stringify(claimed.state)}::text::jsonb where id=${jobId}`;
        const [before] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        const holder = await fixture.sql.reserve();
        let observed: Promise<unknown> | undefined;
        try {
          await holder`begin`;
          await holder`lock table billing_payment_observations in share mode`;
          const [backend] = await holder`select pg_backend_pid() as pid`;
          const result = cleanup.retainInvoice(
            jobId,
            claimed.state.claim.id,
            cleanupWork(claimed.state)!,
            read,
          );
          observed = Promise.allSettled([result]);
          const ordering = await finishedOrBlockedBehind(
            result,
            fixture.sql,
            Number(backend!.pid),
            { now: performance.now, deadlineMs: 300 },
          );
          const [edge] =
            await holder`select clock_timestamp()<(billing_cleanup->'claim'->>'expiresAt')::timestamptz as live from privacy_jobs where id=${jobId}`;
          assert({
            given:
              'the current claim passed initial authority and INSERT waits on a real table lock',
            should: 'be blocked while the original claim is still live',
            actual: [ordering, edge!.live],
            expected: ['blocked', true],
          });
          await holder`select pg_sleep(greatest(0,extract(epoch from (billing_cleanup->'claim'->>'expiresAt')::timestamptz-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
          await holder`commit`;
          await assertRejects({
            given: 'the exact claim expired during the INSERT wait',
            should: 'refuse final progress and roll back the source refinement',
            code: 'CONFLICT',
            actual: () => result,
          });
          const rows =
            await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId} order by id`;
          const [after] =
            await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
          assert({
            given: 'final authority is sampled after the write wait',
            should:
              'preserve original identity, claim, due and attempts with no partial source refinement',
            actual: [rows, after],
            expected: [originalRows, before],
          });
        } finally {
          await holder`rollback`;
          holder.release();
          await observed;
        }
      },
    ),
  15000,
);
