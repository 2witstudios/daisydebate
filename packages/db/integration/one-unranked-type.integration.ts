import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rejectedBy, withFixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261025031248_casual_only_one_on_one_revision';
const scratch = scratchDatabase(url, 'unrankedit');

afterAll(() => scratch.drop());

test(
  'the migration turns practice rows casual and moves one-on-one to revision 2 without moving pinned Rooms (DEC-233, DEC-234)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const hostActorId = await f.actor();
      const room = async (row: Record<string, unknown>) => {
        const id = createId();
        await f.insert('rooms', {
          id,
          host_actor_id: hostActorId,
          title: 'Title',
          topic: 'Topic',
          visibility: 'public',
          format_id: 'one-on-one',
          format_version: 1,
          length: 'full',
          config: validConfig,
          execution_plan: {},
          rules_snapshot: validRules,
          status: 'assembling',
          ...row,
        });
        return id;
      };
      const practiceRoom = await room({ competition_type: 'practice' });
      const rankedRoom = await room({
        competition_type: 'ranked',
        preset_version: 1,
      });
      // That schema still required a length on every Round.
      const practiceRound = await f.round({
        competition_type: 'practice',
        length: 'full',
      });
      await scratch.migrate((folder) => folder <= migration);
      const rooms = await f.sql`
        select id, competition_type, format_version, preset_version,
               rules_snapshot = ${validRules}::jsonb as rules_kept
          from rooms where id in ${f.sql([practiceRoom, rankedRoom])}
         order by competition_type`;
      const [round] = await f.sql`
        select competition_type from rounds where id = ${practiceRound}`;
      const revisions = await f.sql`
        select r.version,
               (select (s->>'defaultDurationMs')::int
                  from jsonb_array_elements(r.definition->'segments') s
                 where s->>'key' = '1AR') as rebuttal_ms
          from format_revisions r
         where r.format_id = 'one-on-one'
         order by r.version`;
      const [pointer] = await f.sql`
        select current_version from formats where id = 'one-on-one'`;
      const presets = await f.sql`
        select length, version, format_version, superseded_at is null as current
          from format_presets
         where format_id = 'one-on-one'
         order by version, length`;
      assert({
        given:
          'a practice Room and Round and a ranked Room pinned to one-on-one revision 1 and preset 1, then the migration',
        should:
          'make the practice rows casual, keep both Rooms on revision 1 with their rules, and point one-on-one and its presets at revision 2',
        actual: {
          rooms: [...rooms],
          round,
          revisions: [...revisions],
          pointer,
          presets: [...presets],
        },
        expected: {
          rooms: [
            {
              id: practiceRoom,
              competition_type: 'casual',
              format_version: 1,
              preset_version: null,
              rules_kept: true,
            },
            {
              id: rankedRoom,
              competition_type: 'ranked',
              format_version: 1,
              preset_version: 1,
              rules_kept: true,
            },
          ],
          round: { competition_type: 'casual' },
          revisions: [
            { version: 1, rebuttal_ms: 300_000 },
            { version: 2, rebuttal_ms: 180_000 },
          ],
          pointer: { current_version: 2 },
          presets: [
            { length: 'full', version: 1, format_version: 1, current: false },
            { length: 'quick', version: 1, format_version: 1, current: false },
            { length: 'full', version: 2, format_version: 2, current: true },
            { length: 'quick', version: 2, format_version: 2, current: true },
          ],
        },
      });
    });
  },
  ddlTimeoutMs,
);

test('casual is the one unranked type a Room or Round row may hold', async () => {
  await withFixture(url, async (fixture) => {
    const hostActorId = await fixture.actor(await fixture.user());
    const formatId = await fixture.format();
    const room = (competitionType: string) =>
      rejectedBy(() =>
        fixture.insert('rooms', {
          id: createId(),
          host_actor_id: hostActorId,
          title: 'Title',
          topic: 'Topic',
          visibility: 'public',
          format_id: formatId,
          format_version: 1,
          competition_type: competitionType,
          config: validConfig,
          execution_plan: {},
          rules_snapshot: validRules,
          status: 'assembling',
        }),
      );
    const round = (competitionType: string) =>
      rejectedBy(() => fixture.round({ competition_type: competitionType }));
    assert({
      given: 'unranked Room and Round rows naming casual and practice',
      should: 'keep the casual rows and refuse practice by its CHECK',
      actual: {
        casualRoom: await room('casual'),
        practiceRoom: await room('practice'),
        casualRound: await round('casual'),
        practiceRound: await round('practice'),
      },
      expected: {
        casualRoom: null,
        practiceRoom: 'rooms_competition_type_check',
        casualRound: null,
        practiceRound: 'rounds_competition_type_check',
      },
    });
  });
});
