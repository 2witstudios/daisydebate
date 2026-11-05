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
    await client.unsafe(
      `insert into account_entitlement_grants (user_id, entitlement, source, starts_at, expires_at, created_at)
       values ($1, 'recording_download', 'subscription', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', '2026-10-02T00:00:00Z')`,
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
      given: 'an account holding beta and time-bounded subscription grants',
      should: 'export source and validity, then erase every grant',
      actual: { exported: exported.account_entitlement_grants, left: left!.c },
      expected: {
        exported: [
          {
            entitlement: 'ai_rounds',
            source: 'beta',
            starts_at: null,
            expires_at: null,
            created_at: '2026-10-02T00:00:00.000Z',
          },
          {
            entitlement: 'recording_download',
            source: 'subscription',
            starts_at: '2026-10-01T00:00:00.000Z',
            expires_at: '2026-11-01T00:00:00.000Z',
            created_at: '2026-10-02T00:00:00.000Z',
          },
          {
            entitlement: 'round_analysis',
            source: 'beta',
            starts_at: null,
            expires_at: null,
            created_at: '2026-10-02T00:00:00.000Z',
          },
        ],
        left: 0,
      },
    });
  });
});
