import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { presencePrivacyAdopter } from './privacy';
setupRitewayBun();

const actorId = 'a'.repeat(24),
  subject = { actorId, userId: 'u'.repeat(24) };

test('Presence erases and exports only the member’s own visibility choice', async () => {
  const date = new Date('2026-10-09T18:00:00.000Z');
  const erased = fakeSql([[]]);
  await presencePrivacyAdopter.erase(
    drizzle({ client: erased.client }),
    subject,
    {
      now: date.toISOString(),
    },
  );
  const exported = fakeSql([
    [{ actor_id: actorId, hidden: true, updated_at: date }],
  ]);
  assert({
    given: 'an erased subject, then an exporting one',
    should: 'delete their setting, and export it with an ISO date',
    actual: [
      presencePrivacyAdopter.phase,
      erased.queries.map((query) => [
        query.query.match(/delete from ([a-z_]+)/)?.[1],
        query.params,
      ]),
      await presencePrivacyAdopter.export(
        drizzle({ client: exported.client }),
        subject,
      ),
    ],
    expected: [
      'after-close',
      [['presence_settings', [actorId]]],
      {
        presence_settings: [
          { actor_id: actorId, hidden: true, updated_at: date.toISOString() },
        ],
      },
    ],
  });
});
