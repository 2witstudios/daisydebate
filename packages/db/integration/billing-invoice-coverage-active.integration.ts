import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withBillingRefunds } from './billing-refunds.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('the Stripe cleanup guard admits only execution version 3', async () =>
  withBillingRefunds(async ({ fixture, userId, actorId }) => {
    const rollback = Error('Owned execution version rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
        const [job] =
          await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const matrix = cleanupCandidate(tx, job!.id);
        const claimed = await matrix.claim();
        const before = await matrix.read();
        const retired = [];
        for (const value of [
          claimed,
          { ...claimed, version: 2 },
          { ...claimed, claim: null, version: 2 },
        ])
          retired.push(
            await matrix.probe(
              () =>
                tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb where id=${matrix.jobId}`,
            ),
          );
        assert({
          given:
            'a current claimed scanning execution rewritten by daisy_web unchanged, then under a retired execution version',
          should:
            'accept the unchanged version 3 write and refuse each retired-version write, leaving the job unchanged',
          actual: [claimed.kind, retired, await matrix.read()],
          expected: ['scanning', ['accepted', '23514', '23514'], before],
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }));
