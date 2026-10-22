import { requireTestServices } from '@daisy/config';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { loadAccountAgeSource } from '../src/account-age';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('age source reads only the requested persisted subject and fails closed on unusable time', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const userId = await fixture.user();
    const otherId = await fixture.user();
    const database = drizzle({ client: fixture.sql });
    const now = '2026-10-09T18:00:00.000Z';
    assert({
      given: 'a subject without a persisted age source',
      should: 'return no source rather than invent an age',
      actual: await loadAccountAgeSource(database, userId),
      expected: null,
    });
    try {
      await fixture.sql`insert into account_age(user_id,birth_month,version,recorded_at)
        values(${userId},'2015-01',2,${now}),(${otherId},'2000-01',1,${now})`;
      assert({
        given: 'two isolated persisted subjects with different birth months',
        should:
          'load each exact source revision and canonical timestamp separately',
        actual: [
          await loadAccountAgeSource(database, userId),
          await loadAccountAgeSource(database, otherId),
        ],
        expected: [
          { birthMonth: '2015-01', revision: 2, recordedAt: now },
          { birthMonth: '2000-01', revision: 1, recordedAt: now },
        ],
      });
      await fixture.sql`update account_age set recorded_at='-infinity' where user_id=${userId}`;
      assert({
        given: 'a nonfinite persisted time on only the requesting subject',
        should:
          'fail closed for that source while preserving the other subject',
        actual: [
          await loadAccountAgeSource(database, userId),
          await loadAccountAgeSource(database, otherId),
        ],
        expected: [
          null,
          { birthMonth: '2000-01', revision: 1, recordedAt: now },
        ],
      });
    } finally {
      await fixture.sql`delete from account_age where user_id in (${userId},${otherId})`;
    }
  });
});
