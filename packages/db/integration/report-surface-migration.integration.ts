import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const surfaceMigration = '20261103050553_report_surface_people';
const scratch = scratchDatabase(databaseUrl, 'reportsurface');
afterAll(() => scratch.drop());

test(
  'the migration moves a report made from the list to the people surface',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < surfaceMigration);
    await withFixture(scratch.url, async (fixture) => {
      const client = new SQL(scratch.url);
      const reporter = await fixture.actor();
      const subject = await fixture.actor();
      const other = await fixture.actor();
      const fromList = createId();
      const fromProfile = createId();
      const insert = (id: string, about: string, surface: string) =>
        client.unsafe(
          "insert into reports (id, reporter_actor_id, subject_actor_id, reason, surface, created_at) values ($1, $2, $3, 'spam', $4, now())",
          [id, reporter, about, surface],
        );
      await insert(fromList, subject, 'online');
      await insert(fromProfile, other, 'profile');
      await scratch.migrate((folder) => folder <= surfaceMigration);
      const rows = (await client.unsafe(
        'select id, surface from reports where id = any($1)',
        [`{${fromList},${fromProfile}}`],
      )) as { id: string; surface: string }[];
      const surfaceOf = (id: string) =>
        rows.find((row) => row.id === id)?.surface;
      const refused = await client
        .unsafe('update reports set surface = $1 where id = $2', [
          'online',
          fromProfile,
        ])
        .then(
          () => false,
          () => true,
        );
      assert({
        given: 'a report filed under the old surface name and one from a profile',
        should:
          'move the first to people, keep the second, and refuse the old name',
        actual: [surfaceOf(fromList), surfaceOf(fromProfile), refused],
        expected: ['people', 'profile', true],
      });
      await client.unsafe('delete from reports where id = any($1)', [
        `{${fromList},${fromProfile}}`,
      ]);
      await client.close();
    });
  },
  ddlTimeoutMs,
);
