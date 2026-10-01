import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleSummary } from '../../ui/mock/train';
import { hubView } from './hub';

setupRitewayBun();

describe('hubView', () => {
  test('nothing done', () => {
    const view = hubView(sampleSummary, { mins: 20, did: [] });
    assert({
      given: 'a twenty minute plan with nothing finished',
      should: 'stay in the plan stage with every row open',
      actual: [view.stage, view.plan.map((row) => row.done), view.totalMinutes],
      expected: ['plan', [false, false, false], 20],
    });
  });

  test('partly done', () => {
    assert({
      given: 'review and impact drill done on a twenty minute plan',
      should: 'still be in the plan stage',
      actual: hubView(sampleSummary, {
        mins: 20,
        did: ['review', 'impact-drill'],
      }).stage,
      expected: 'plan',
    });
  });

  test('done', () => {
    const view = hubView(sampleSummary, {
      mins: 10,
      did: ['review', 'impact-drill'],
    });
    assert({
      given: 'every item of the ten minute plan finished',
      should: 'reach the done stage',
      actual: [view.stage, view.plan.map((row) => row.done)],
      expected: ['done', [true, true]],
    });
  });

  test('what is next', () => {
    assert({
      given: 'the sample account before and after finishing the plan',
      should: 'recommend the weak-spot drill, then offer an optional one',
      actual: [
        hubView(sampleSummary, { mins: 20, did: [] }).next,
        hubView(sampleSummary, { mins: 10, did: ['review', 'impact-drill'] })
          .next?.kind,
      ],
      expected: [
        {
          kind: 'recommended',
          title: 'Impact drill',
          reason:
            'Your impact was missing or unclear in 4 of your last 6 drills. Two short rounds on saying why it matters, and to whom.',
          minutes: 8,
          href: '/train/drill?kind=impact',
        },
        'optional',
      ],
    });
  });

  test('no weak spot', () => {
    assert({
      given: 'an account with no weak spot and a plan in progress',
      should: 'recommend nothing',
      actual: hubView(
        { ...sampleSummary, weakSpot: null },
        { mins: 20, did: [] },
      ).next,
      expected: null,
    });
  });
});
