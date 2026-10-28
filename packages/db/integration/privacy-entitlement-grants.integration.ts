import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entitlementGrantPrivacyAdopter } from '../src/entitlement-grants-privacy';
import { exportThenErase, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);

const adoption = [entitlementGrantPrivacyAdopter];

test('export carries the subject’s entitlement grants and erasure removes them (ISSUE-779)', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    await client.unsafe(
      `insert into account_entitlement_grants (user_id, entitlement, source, created_at)
       values ($1, 'round_analysis', 'beta', timestamptz '2026-10-02 00:00:00+00'),
              ($1, 'ai_rounds', 'beta', timestamptz '2026-10-02 00:00:00+00')`,
      [userId],
    );
    const exported = await exportThenErase(
      database,
      { userId, actorId },
      adoption,
    );
    const [left] = (await client.unsafe(
      'select count(*)::int as c from account_entitlement_grants where user_id = $1',
      [userId],
    )) as Array<{ c: number }>;
    assert({
      given: 'an account holding both beta grants',
      should: 'export both grants, then erase every one of them',
      actual: { exported: exported.account_entitlement_grants, left: left!.c },
      expected: {
        exported: [
          {
            entitlement: 'ai_rounds',
            source: 'beta',
            created_at: '2026-10-02T00:00:00.000Z',
          },
          {
            entitlement: 'round_analysis',
            source: 'beta',
            created_at: '2026-10-02T00:00:00.000Z',
          },
        ],
        left: 0,
      },
    });
  });
});
