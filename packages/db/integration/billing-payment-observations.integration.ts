import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('closed-account cleanup reads retained observations through actual runtime authority', async () =>
  withClosedPurchase(true, async ({ cleanup, jobId, fixture }) => {
    const claim = await cleanup.claim(jobId);
    if (
      claim.kind !== 'claimed' ||
      claim.state.kind === 'acknowledged' ||
      !claim.state.claim
    )
      throw Error('Missing observation claim');
    const [before] =
      await fixture.sql`select billing_cleanup,retry_at,attempts from privacy_jobs where id=${jobId}`;
    const result = await cleanup.observations(
      jobId,
      claim.state.claim.id,
      claim.work,
      null,
    );
    const [after] =
      await fixture.sql`select billing_cleanup,retry_at,attempts from privacy_jobs where id=${jobId}`;
    assert({
      given:
        'an owned closed-account current claim with no retained observation',
      should:
        'read an empty bounded page without acknowledging or changing execution authority',
      actual: [result, after],
      expected: [
        { kind: 'observations', observations: [], more: false },
        before,
      ],
    });
  }));
