import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
requireTestServices(process.env);
setupRitewayBun();
test('cleanup resource reads page only its closed sponsor and retain exact selected ownership under current runtime authority', async () =>
  withClosedPurchase(
    true,
    async ({ fixture, renew, cleanup, subject, jobId }) => {
      const [original] =
        await fixture.sql`select id from billing_purchases where user_id=${subject.userId}`;
      for (let index = 0; index < 21; index++) {
        const id = createId();
        await fixture.sql`insert into billing_purchases(id,user_id,mode,price_id,vendor_customer_id,return_origin,admitted_at,state)
   select ${id},user_id,mode,price_id,vendor_customer_id,return_origin,admitted_at,
    state||jsonb_build_object('sessionId',${`cs_test_${id}`}::text,'subscriptionId',${`sub_${id}`}::text)
   from billing_purchases where id=${original!.id}`;
      }
      const foreignUser = await fixture.user(),
        foreignId = createId();
      try {
        await fixture.sql`insert into billing_purchases(id,user_id,mode,price_id,return_origin,admitted_at,state)
   values(${foreignId},${foreignUser},'test','price_foreign','https://daisy.example',clock_timestamp(),' {"kind":"admitted"}'::jsonb)`;
        const claim = async () => {
          await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
          await renew();
          const c = await cleanup.claim(jobId);
          if (
            c.kind !== 'claimed' ||
            c.state.kind === 'acknowledged' ||
            !c.state.claim
          )
            throw Error('Missing resource claim');
          return { ...c, claimId: c.state.claim.id };
        };
        let c = await claim();
        const page = await cleanup.resources(jobId, c.claimId, c.work);
        const expected =
          await fixture.sql`select id from billing_purchases where user_id=${subject.userId} order by id`;
        assert({
          given:
            '22 owned historical purchase identities and another sponsor purchase under actual daisy_web',
          should:
            'read a bounded20-item owned page with an honest retained continuation',
          actual: page,
          expected: {
            kind: 'page',
            ids: expected.slice(0, 20).map((row: { id: string }) => row.id),
            more: true,
          },
        });
        if (page.kind !== 'page') throw Error('Missing resource page');
        await cleanup.record(jobId, {
          kind: 'page',
          claimId: c.claimId,
          work: c.work,
          ids: page.ids,
          more: page.more,
        });
        for (let lane = 0; lane < 4; lane++) {
          c = await claim();
          const [clock] = await fixture.sql`select clock_timestamp() as at`;
          await cleanup.record(jobId, {
            kind: 'failure',
            claimId: c.claimId,
            work: c.work,
            retryAt: new Date(clock!.at.getTime() + 100).toISOString(),
          });
        }
        c = await claim();
        const [before] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        const selected = await cleanup.resources(jobId, c.claimId, c.work);
        const stale = await cleanup.resources(jobId, createId(), c.work);
        const [after] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        assert({
          given: 'a durable selected purchase read and a stale token',
          should:
            'return only its original frozen source, refuse stale authority and change no job facts',
          actual: [
            selected.kind === 'purchase' && [
              selected.purchase.id,
              selected.purchase.userId,
              selected.purchase.priceId,
            ],
            stale,
            after,
          ],
          expected: [
            [expected[0]!.id, subject.userId, 'price_fixture'],
            { kind: 'refuse' },
            before,
          ],
        });
      } finally {
        await fixture.sql`delete from billing_purchases where user_id=${foreignUser}`;
      }
    },
  ));

test('a selected foreign purchase cannot be read or handed to vendor execution even if a trusted scan result was wrong', async () =>
  withClosedPurchase(
    false,
    async ({ fixture, renew, cleanup, subject, jobId }) => {
      const foreignUser = await fixture.user(),
        foreignId = createId();
      try {
        await fixture.sql`insert into billing_purchases(id,user_id,mode,price_id,return_origin,admitted_at,state)
   values(${foreignId},${foreignUser},'test','price_foreign','https://daisy.example',clock_timestamp(),'{"kind":"admitted"}'::jsonb)`;
        const claim = async () => {
          await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
          await renew();
          const c = await cleanup.claim(jobId);
          if (
            c.kind !== 'claimed' ||
            c.state.kind === 'acknowledged' ||
            !c.state.claim
          )
            throw Error('Missing resource claim');
          return { ...c, claimId: c.state.claim.id };
        };
        let c = await claim();
        await cleanup.record(jobId, {
          kind: 'page',
          claimId: c.claimId,
          work: c.work,
          ids: [foreignId],
          more: false,
        });
        for (let lane = 0; lane < 4; lane++) {
          c = await claim();
          const [clock] = await fixture.sql`select clock_timestamp() as at`;
          await cleanup.record(jobId, {
            kind: 'failure',
            claimId: c.claimId,
            work: c.work,
            retryAt: new Date(clock!.at.getTime() + 100).toISOString(),
          });
        }
        c = await claim();
        const [before] =
          await fixture.sql`select billing_cleanup,retry_at,attempts from privacy_jobs where id=${jobId}`;
        const selected = await cleanup.resources(jobId, c.claimId, c.work);
        const [after] =
          await fixture.sql`select billing_cleanup,retry_at,attempts from privacy_jobs where id=${jobId}`;
        const [foreign] =
          await fixture.sql`select user_id,price_id,state from billing_purchases where id=${foreignId}`;
        assert({
          given:
            'a current owned job contains an incorrectly selected other-account purchase identity',
          should:
            'refuse before vendor handoff, preserving both the owed job and foreign original source',
          actual: [selected, after, foreign, subject.userId === foreignUser],
          expected: [
            { kind: 'refuse' },
            before,
            {
              user_id: foreignUser,
              price_id: 'price_foreign',
              state: { kind: 'admitted' },
            },
            false,
          ],
        });
      } finally {
        await fixture.sql`delete from billing_purchases where user_id=${foreignUser}`;
      }
    },
  ));
