import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('an assembling ranked Room keeps its sides on the flip (ADR 0145)', async () => {
  await withFixture(databaseUrl, async (f) => {
    const formatId = await f.format();
    await f.preset(formatId);
    const ranked = await f.room(await f.actor(), formatId, {
      competition_type: 'ranked',
      preset_version: 1,
    });
    const casual = await f.room(await f.actor(), formatId);
    const fix = (id: string) =>
      rejectedBy(
        () =>
          f.sql`update rooms set team_one_side = 'affirmative' where id = ${id}`,
      );
    assert({
      given:
        'an assembling ranked Room and an assembling casual Room, then team 1 fixed on Affirmative on each',
      should: 'refuse fixing the ranked Room’s side and accept the casual one',
      actual: [await fix(ranked), await fix(casual)],
      expected: ['rooms_ranked_sides_open_check', null],
    });
  });
});
