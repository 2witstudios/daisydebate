import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a report names only a surface people can file from', async () => {
  await withFixture(databaseUrl, async (f) => {
    const reporter = await f.actor();
    const subject = await f.actor();
    const report = (surface: string) =>
      rejectedBy(
        () =>
          f.sql`insert into reports (id, reporter_actor_id, subject_actor_id, reason, surface, created_at)
            values (${createId()}, ${reporter}, ${subject}, 'spam', ${surface}, now())`,
      );
    try {
      assert({
        given: 'a report from the people list and one under the retired name',
        should: 'accept the people surface and refuse the old one',
        actual: [await report('people'), await report('online')],
        expected: [null, 'reports_surface_check'],
      });
    } finally {
      await f.sql`delete from reports where reporter_actor_id = ${reporter}`;
    }
  });
});
