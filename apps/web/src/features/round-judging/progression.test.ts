import { syntheticCaseMap } from '@daisy/db/testing';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  judgingProgress,
  firstPassLost,
} from '@daisy/protocol/round-judging-progression';
import { requireNextStage } from './progression';
setupRitewayBun();

test('a job needs one coherency stage at a time, and the final one reads the map (ADR 0125)', async () => {
  const caseMap = syntheticCaseMap;
  const ballot = { rubricVersion: 'speaker-10@2', winner: 'affirmative' };
  type Stage = Parameters<typeof judgingProgress>[0];
  const stages = (overrides: Partial<Stage>): Stage => ({
    pendingBallot: null,
    firstBallot: null,
    firstBallotFailed: false,
    caseMap: null,
    ...overrides,
  });
  assert({
    given:
      'a new job, a stored or failed first pass, a stored map, and a held ballot',
    should:
      'need the first pass, then the map, then the final ballot with that map, then nothing',
    actual: [
      judgingProgress(stages({})),
      judgingProgress(stages({ firstBallot: ballot })),
      judgingProgress(stages({ firstBallotFailed: true })),
      judgingProgress(stages({ firstBallotFailed: true, caseMap })),
      judgingProgress(stages({ caseMap, pendingBallot: ballot })),
    ],
    expected: [
      { kind: 'stage_due', due: { stage: 'first' } },
      { kind: 'stage_due', due: { stage: 'map' } },
      { kind: 'stage_due', due: { stage: 'map' } },
      { kind: 'stage_due', due: { stage: 'final', caseMap } },
      { kind: 'ballot_held', ballot },
    ],
  });
  for (const [label, candidate, stage] of [
    ['a new job', stages({}), 'map'],
    ['a stored map', stages({ firstBallotFailed: true, caseMap }), 'map'],
    ['a held ballot', stages({ caseMap, pendingBallot: ballot }), 'final'],
  ] as const)
    await assertRejects({
      given: label,
      should: `refuse to buy the ${stage} stage`,
      actual: () => requireNextStage(candidate, stage),
      code: 'CONFLICT',
    });
});

test('a first pass lost with its run is its one try', () => {
  const fresh = { firstBallot: null, firstBallotFailed: false } as const;
  assert({
    given:
      'a takeover finding a prior first-pass call still dispatched, failed, or absent, or a first pass already settled',
    should: 'count only the lost, unsettled call as the spent try',
    actual: [
      firstPassLost(fresh, { outcome: 'dispatched' }),
      firstPassLost(fresh, { outcome: 'failed' }),
      firstPassLost(fresh, undefined),
      firstPassLost(
        { firstBallot: null, firstBallotFailed: true },
        { outcome: 'dispatched' },
      ),
    ],
    expected: [true, false, false, false],
  });
});
