import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createStrayEgressSweep } from './stray-egress-sweep';

setupRitewayBun();

const run = async (input: {
  readonly recorded: readonly (string | null | undefined)[];
  readonly claim?: boolean;
  readonly stopFails?: string;
}) => {
  const stopped: string[] = [];
  const reports: string[] = [];
  let reads = 0;
  await createStrayEgressSweep({
    listStages: async () => [
      { egressId: 'EG_A', captureId: 'c1' },
      { egressId: 'EG_B', captureId: 'c2' },
    ],
    stop: async (id) => {
      if (input.stopFails === id) throw new Error('down');
      stopped.push(id);
    },
    owners: [
      {
        recordedEgress: async () => {
          const answer = input.recorded[reads++];
          return answer === undefined ? null : { egressId: answer };
        },
        claim: async () => input.claim ?? true,
      },
    ],
    report: (event) => reports.push(event),
  })();
  return { stopped, reports };
};

describe('createStrayEgressSweep', () => {
  test('leaves what its capture recorded, and what belongs to nobody here', async () => {
    assert({
      given: 'an Egress its capture recorded, and one no capture here knows',
      should: 'stop neither',
      actual: await run({ recorded: ['EG_A', undefined] }),
      expected: { stopped: [], reports: [] },
    });
  });
  test('stops one left by a crash before its record', async () => {
    assert({
      given:
        'a running Egress its capture never recorded, still so under claim',
      should: 'stop it and say so',
      actual: await run({ recorded: ['EG_A', null, null] }),
      expected: {
        stopped: ['EG_B'],
        reports: ['stage.stray_egress_stopped'],
      },
    });
  });
  test('never stops a start still in flight', async () => {
    assert({
      given: 'the claim held, as it is across a start',
      should: 'leave it for the next pass',
      actual: await run({ recorded: [null, null], claim: false }),
      expected: { stopped: [], reports: [] },
    });
    assert({
      given: 'the record landing between the first read and the claim',
      should: 'not stop it',
      actual: await run({ recorded: ['EG_A', 'OTHER', 'EG_B'] }),
      expected: { stopped: [], reports: [] },
    });
  });
  test('a failed stop reaches only that Egress', async () => {
    assert({
      given: 'the first stray refusing to stop',
      should: 'report it and still stop the second',
      actual: await run({
        recorded: [null, null, null, null],
        stopFails: 'EG_A',
      }),
      expected: {
        stopped: ['EG_B'],
        reports: ['stage.stray_sweep_failed', 'stage.stray_egress_stopped'],
      },
    });
  });
});
