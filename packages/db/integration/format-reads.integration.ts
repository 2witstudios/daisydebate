import { hostWaits } from '@daisy/worker/host';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readFormatSelectionFacts } from '../src/format-operations';
import { finishedOrBlockedBehind } from '../src/testing';
import { withDatabase, withFixture } from './constraint-helpers';
import { foundationDefinition, validConfig } from './round-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('format readers resolve the current and pinned revisions independently', async () => {
  await withFixture(url, async (fixture) => {
    const id = await fixture.format();
    const corruptDefinition = { version: 1 };
    await fixture.insert(
      'format_revisions',
      { format_id: id, version: 2, definition: corruptDefinition },
      'format_id',
    );
    await withDatabase(url, async (database) => {
      const noPreset = await database.getCurrentPreset(id);
      await fixture.preset(id);
      const preset = await database.getCurrentPreset(id);
      await fixture.sql`update format_presets set superseded_at = now() where format_id = ${id}`;
      await fixture.sql`update formats set current_version = 2 where id = ${id}`;
      const read = (presetVersion: number) =>
        readFormatSelectionFacts(drizzle({ client: fixture.sql }), {
          formatId: id,
          formatVersion: 1,
          presetVersion,
        });
      assert({
        given:
          'an older preset, an advanced pointer and a stored incomplete definition',
        should:
          'keep pinned facts and return the current JSON unchanged, with null for missing format, preset and tuple',
        actual: [
          await database.getFormat(id),
          await database.getFormatRevision(id, 1),
          await database.getFormat('missing-format'),
          noPreset,
          preset,
          await read(1),
          await read(2),
        ],
        expected: [
          {
            id,
            name: 'Fixture format',
            version: 2,
            definition: corruptDefinition,
          },
          foundationDefinition,
          null,
          null,
          { formatId: id, version: 1, formatVersion: 1, config: validConfig },
          {
            format: {
              id,
              name: 'Fixture format',
              leagues: [],
              catalogOwned: true,
              role: null,
              currentVersion: 2,
            },
            definition: foundationDefinition,
            preset: {
              version: 1,
              formatVersion: 1,
              config: validConfig,
              rankedEligible: false,
              current: false,
            },
          },
          null,
        ],
      });
      await assertRejects({
        given: 'a pinned revision the table does not hold',
        should: 'raise the missing-revision invariant',
        actual: () => database.getFormatRevision(id, 9),
        code: 'INVARIANT',
      });
    });
  });
});

test('selection waits for the publisher’s format lock', async () => {
  await withFixture(url, async (publisher) => {
    const id = await publisher.format();
    await publisher.preset(id);
    await withFixture(url, async (reader) => {
      const db = drizzle({ client: reader.sql });
      const { blocked, read } = await publisher.sql.begin(async (tx) => {
        const [{ pid }] = await tx`select pg_backend_pid() as pid`;
        await tx`select id from formats where id = ${id} for update`;
        const read = readFormatSelectionFacts(db, {
          formatId: id,
          formatVersion: 1,
          presetVersion: 1,
        });
        const blocked = await finishedOrBlockedBehind(read, reader.sql, pid, {
          waits: hostWaits,
        });
        return { blocked, read };
      });
      assert({
        given: 'a publication holding the same format row',
        should: 'block selection until the publisher releases its lock',
        actual: [blocked, (await read)?.format.id],
        expected: ['blocked', id],
      });
    });
  });
});
