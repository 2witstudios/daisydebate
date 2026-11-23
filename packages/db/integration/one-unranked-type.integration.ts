import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rejectedBy, withFixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

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
