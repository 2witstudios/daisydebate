import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withBillingRefunds } from './billing-refunds.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('actual runtime role admits five-lane initial authority and refuses generic NULL-execution success', async () =>
  withBillingRefunds(async ({ fixture, userId, actorId }) => {
    const rollback = Error('Five lane admission rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
        const [job] =
          await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const matrix = cleanupCandidate(tx, job!.id);
        const before = await matrix.read();
        const generic = await matrix.probe(
          () =>
            tx`update privacy_jobs set status='succeeded',succeeded_at=clock_timestamp() where id=${matrix.jobId}`,
        );
        const initial = await matrix.probe(() => matrix.claim());
        assert({
          given:
            'the real daisy_web role under canonical closed-account authority with an uninitialized Stripe execution',
          should:
            'admit a fresh five-lane claim and reject generic success with no typed financial outcome',
          actual: [initial, generic, await matrix.read()],
          expected: ['accepted', '23514', before],
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }));
