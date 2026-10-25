import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { sqlStateOf, withFixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('a length, a quick preset or the Quick ladder is refused on every table (DEC-237, DEC-238)', async () => {
  await withFixture(url, async (fixture) => {
    const host = await fixture.actor();
    const formatId = await fixture.format();
    const room = (extra: Record<string, unknown>) =>
      sqlStateOf(() =>
        fixture.insert('rooms', {
          id: createId(),
          host_actor_id: host,
          title: 'Title',
          topic: 'Topic',
          visibility: 'public',
          format_id: formatId,
          format_version: 1,
          competition_type: 'casual',
          config: validConfig,
          execution_plan: {},
          rules_snapshot: validRules,
          status: 'assembling',
          ...extra,
        }),
      );
    const quickPreset = sqlStateOf(() =>
      fixture.sql.unsafe(
        `insert into format_presets (format_id, length, version, format_version, config, approved_at)
         values ($1, 'quick', 9, 1, $2::jsonb, statement_timestamp())`,
        [formatId, validConfig],
      ),
    );
    assert({
      given:
        'a Room and a Round with and without a length, a quick preset, a second current preset and a Round on the Quick ladder',
      should:
        'accept only the rows with no length, and refuse the rest: no column, one current preset, one ladder',
      actual: {
        room: await room({}),
        quickRoom: await room({ length: 'quick' }),
        round: await sqlStateOf(() => fixture.round()),
        fullRound: await sqlStateOf(() => fixture.round({ length: 'full' })),
        quickPreset: await quickPreset,
        secondCurrent: await sqlStateOf(async () => {
          await fixture.preset(formatId, 1);
          await fixture.preset(formatId, 2);
        }),
        quickLadder: await sqlStateOf(() =>
          fixture.round({
            competition_type: 'ranked',
            preset_version: 1,
            ladder_id: 'quick',
          }),
        ),
      },
      expected: {
        room: 'accepted',
        quickRoom: '42703',
        round: 'accepted',
        fullRound: '42703',
        quickPreset: '42703',
        secondCurrent: '23505',
        quickLadder: '23514',
      },
    });
  });
});
