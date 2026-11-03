import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contentModerationPrivacyAdopter } from '../src/content-moderation-privacy';
import { exportThenErase, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('export carries the subject’s reports and ban; erasure keeps the report with no reporter', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    const reportId = createId();
    const targetId = createId();
    await client.unsafe(
      `insert into content_reports (id, reporter_user_id, target_kind, target_id, reason, queue, created_at)
       values ($1, $2, 'round', $3, 'spam', 'safety', timestamptz '2026-10-02 00:00:00+00')`,
      [reportId, userId, targetId],
    );
    await client.unsafe(
      `insert into audience_bans (user_id, banned_by_ref, created_at)
       values ($1, 'operator', timestamptz '2026-10-02 00:00:00+00')`,
      [userId],
    );
    const exported = await exportThenErase(database, { userId, actorId }, [
      contentModerationPrivacyAdopter,
    ]);
    const [report] = (await client.unsafe(
      'select reporter_user_id from content_reports where id = $1',
      [reportId],
    )) as { reporter_user_id: string | null }[];
    const [bans] = (await client.unsafe(
      'select count(*)::int as c from audience_bans where user_id = $1',
      [userId],
    )) as { c: number }[];
    await client.unsafe('delete from content_reports where id = $1', [
      reportId,
    ]);
    assert({
      given: 'an account with one report and one ban',
      should: 'export both, then keep the report nameless and delete the ban',
      actual: {
        reports: exported.content_reports,
        bansExported: exported.audience_bans?.length,
        reporter: report!.reporter_user_id,
        bans: bans!.c,
      },
      expected: {
        reports: [
          {
            target_kind: 'round',
            target_id: targetId,
            reason: 'spam',
            status: 'open',
            created_at: '2026-10-02T00:00:00.000Z',
          },
        ],
        bansExported: 1,
        reporter: null,
        bans: 0,
      },
    });
  });
});
