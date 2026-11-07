import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
requireTestServices(process.env);
setupRitewayBun();

test(
  'actual observation retention races and lost commit replies preserve exact owed facts and atomic five-lane progress',
  async () =>
    withClosedPurchase(
      true,
      async ({ fixture, pool, subject, session, cleanup, jobId, renew }) => {
        const source = {
          kind: 'unresolved',
          vendorSubscriptionId: session.subscriptionId,
          priceId: null,
        };
        await fixture.sql.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`select * from public.daisy_authorization_accounts_v2(array[${subject.actorId}]::text[],null::text,true)`;
          await tx`select id from privacy_jobs where id=${jobId} for update`;
          for (let index = 0; index < 2; index++)
            await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
        insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,source,state,closed_at,created_at,observed_at)
        select ${createId()},account.id,'test',${session.customerId},${`in_${createId()}`},'invoice',${JSON.stringify(source)}::text::jsonb,'{"kind":"owed","reason":"enumeration_unavailable"}'::jsonb,account.deleted_at,sampled.at,sampled.at from users account cross join sampled where account.id=${subject.userId}`;
        });
        const claim = async () => {
          await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
          await renew();
          const c = await cleanup.claim(jobId);
          if (
            c.kind !== 'claimed' ||
            c.state.kind === 'acknowledged' ||
            !c.state.claim
          )
            throw Error('Missing current retained-observation claim');
          return { ...c, claimId: c.state.claim.id };
        };
        try {
          for (let lane = 0; lane < 4; lane++) {
            const c = await claim();
            const progress =
              c.work.kind === 'scan' && c.work.lane === 'invoices'
                ? await cleanup.retainInvoicePage(jobId, c.claimId, c.work, {
                    reads: [],
                    more: false,
                  })
                : await cleanup.record(jobId, {
                    kind: 'page',
                    claimId: c.claimId,
                    work: c.work,
                    ids: [],
                    more: false,
                  });
            if (progress !== 'progress')
              throw Error('Retention setup page refused');
          }
          let c = await claim();
          const page = await cleanup.observations(
            jobId,
            c.claimId,
            c.work,
            null,
          );
          if (page.kind !== 'observations')
            throw Error('Missing owned observation keyset');
          await cleanup.record(jobId, {
            kind: 'page',
            claimId: c.claimId,
            work: c.work,
            ids: page.observations.map((row) => row.id),
            more: page.more,
          });
          c = await claim();
          const before =
            await fixture.sql`select id,source,state,closed_at,created_at,observed_at from billing_payment_observations where user_id=${subject.userId} order by id`;
          const race = await Promise.all([
            cleanup.retainObservation(jobId, c.claimId, c.work),
            cleanup.retainObservation(jobId, c.claimId, c.work),
          ]);
          const [advanced] =
            await fixture.sql`select attempts,billing_cleanup from privacy_jobs where id=${jobId}`;
          assert({
            given:
              'two current-service retainers for one exact selected owed observation',
            should:
              'commit one remainder advance with no failure, new identity or financial classification',
            actual: [
              race.sort(),
              advanced!.attempts,
              advanced!.billing_cleanup.scans.observations.id,
              advanced!.billing_cleanup.claim,
            ],
            expected: [['idle', 'progress'], 0, page.observations[1]!.id, null],
          });
          c = await claim();
          const restore = loseTransactionCommitReply(pool, 2);
          try {
            await assertRejects({
              given:
                'the final exact observation commits but the reply is lost',
              should:
                'report uncertainty while durable owed facts and head restart survive',
              code: 'INFRASTRUCTURE',
              actual: () => cleanup.retainObservation(jobId, c.claimId, c.work),
            });
          } finally {
            restore();
          }
          const [committed] =
            await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
          const committedRows =
            await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId} order by id`;
          const replay = await cleanup.retainObservation(
            jobId,
            c.claimId,
            c.work,
          );
          const after =
            await fixture.sql`select id,source,state,closed_at,created_at,observed_at from billing_payment_observations where user_id=${subject.userId} order by id`;
          const [unchanged] =
            await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
          const replayedRows =
            await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId} order by id`;
          assert({
            given:
              'recovery after a consumed five-lane retention claim with unresolved evidence',
            should:
              'keep exact source/facts/identity, remain pending on head discovery and leave replay entirely idle',
            actual: [
              after,
              committed!.billing_cleanup.kind,
              committed!.billing_cleanup.turn,
              replay,
              unchanged,
              replayedRows,
            ],
            expected: [
              before,
              'scanning',
              'purchases',
              'idle',
              committed,
              committedRows,
            ],
          });
        } finally {
          await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
        }
      },
    ),
  15000,
);
