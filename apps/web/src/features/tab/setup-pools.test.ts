import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleSetup } from './sample/setup';
import { AUTUMN } from './sample/moment';
import { tournamentSetupOf } from './setup';
setupRitewayBun();
test('preliminary rounds consume their assigned pool only', () => {
  const sample = sampleSetup(AUTUMN, {
    viewer: 'host',
    moment: 'before',
    scale: 'normal',
  });
  if (!sample) throw new Error('Expected setup fixture');
  const event = sample.reads.setup.events.find(
    (one) => one.eventId === sample.reads.eventId,
  )!;
  const pools = [
    { resolutionPoolId: 'a'.repeat(24), name: 'First pool', size: 10 },
    { resolutionPoolId: 'b'.repeat(24), name: 'Second pool', size: 4 },
  ];
  const prelim = event.stages.find(
    (stage) => stage.kind === 'preliminary',
  )!.stageId;
  const rounds = event.tabRounds.map((round, index) => ({
    ...round,
    resolutionPoolId:
      round.stageId === prelim
        ? pools[index < 2 ? 0 : 1]!.resolutionPoolId
        : null,
  }));
  const setup = tournamentSetupOf(
    {
      ...sample.reads,
      setup: {
        ...sample.reads.setup,
        events: [{ ...event, tabRounds: rounds }],
        resolutionPools: pools,
      },
    },
    sample.context,
  );
  assert({
    given:
      'four prelims split evenly between pools, striking from five per round',
    should:
      'count ten resolutions for each assigned pool, with no elimination demand or pooling across inventories',
    actual: setup?.settings
      .filter((line) => line.keys.includes('resolution.rule'))
      .map((line) => ({ id: line.id, attention: line.attention })),
    expected: [
      { id: pools[0]!.resolutionPoolId, attention: null },
      { id: pools[1]!.resolutionPoolId, attention: 'the pool has 4, needs 10' },
    ],
  });
});
