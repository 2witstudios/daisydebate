import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fakeSql } from './index.test-support';
import { competitiveRecordPrivacyAdopter } from './competitive-record-privacy';

setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };

test('the competitive-record step erases nothing and reads only the subject rows', async () => {
  const fake = fakeSql([[], [], [], [], [], [], [], []]);
  const tx = drizzle({ client: fake.client });
  await competitiveRecordPrivacyAdopter.erase(tx, subject, {
    now: '2026-10-28T00:00:00.000Z',
  });
  const exported = await competitiveRecordPrivacyAdopter.export(tx, subject);
  assert({
    given: 'the competitive record, which erasure keeps whole (DEC-261)',
    should:
      'delete nothing and export every record table, scoped to the subject actor',
    actual: [
      fake.queries.filter(({ query }) => query.toLowerCase().includes('delete'))
        .length,
      Object.keys(exported).sort(),
    ],
    expected: [
      0,
      [
        'ballots',
        'rating_changes',
        'ratings',
        'room_participants',
        'room_resolution_strikes',
        'rooms',
        'round_participants',
        'rounds',
      ],
    ],
  });
  assert({
    given: 'every record read',
    should:
      'bound each query by the subject actor id and never another member id',
    actual: [
      fake.queries.length,
      fake.queries.every(({ params }) =>
        JSON.stringify(params).includes(subject.actorId),
      ),
      fake.queries.some(
        ({ query, params }) =>
          JSON.stringify(params).includes(subject.userId) &&
          !query.includes('users'),
      ),
    ],
    expected: [8, true, false],
  });
});
