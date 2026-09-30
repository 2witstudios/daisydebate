import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleSummary } from '../../ui/mock/train';
import { buildPlan, planTotal } from './plan';

setupRitewayBun();

const titles = (mins: 10 | 20 | 40) =>
  buildPlan(mins, sampleSummary).map((item) => item.title);

describe('buildPlan', () => {
  test('each time has its items', () => {
    assert({
      given: 'ten, twenty and forty minutes',
      should: 'add a responding drill at twenty and practice at forty',
      actual: [titles(10), titles(20), titles(40)],
      expected: [
        ['Spaced review', 'Impact drill'],
        ['Spaced review', 'Impact drill', 'Responding drill'],
        ['Spaced review', 'Impact drill', 'Guided practice'],
      ],
    });
  });

  test('totals', () => {
    assert({
      given: 'the three plans',
      should: 'add up their minutes',
      actual: ([10, 20, 40] as const).map((mins) =>
        planTotal(buildPlan(mins, sampleSummary)),
      ),
      expected: [10, 20, 40],
    });
  });

  test('review follows what is due', () => {
    const [review] = buildPlan(10, {
      ...sampleSummary,
      saved: { ...sampleSummary.saved, due: 1 },
    });
    assert({
      given: 'one argument due',
      should: 'say so in the singular and offer to review one',
      actual: [review?.meta, review?.cta],
      expected: ['1 argument due', 'Review 1'],
    });
  });

  test('the drill follows the weak spot', () => {
    assert({
      given: 'a weak warrant',
      should: 'name the warrant drill in the plan',
      actual: buildPlan(10, {
        ...sampleSummary,
        weakSpot: { part: 'warrant', missing: 3, of: 6 },
      }).map((item) => [item.title, item.href]),
      expected: [
        ['Spaced review', '/train/review'],
        ['Warrant drill', '/train/drill?kind=warrant'],
      ],
    });
  });
});
