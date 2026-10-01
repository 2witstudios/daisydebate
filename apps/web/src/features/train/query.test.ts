import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultHubQuery,
  hubHref,
  parseHubQuery,
  parseWelcomeGoal,
  withDone,
  withPlanContext,
} from './query';

setupRitewayBun();

describe('parseHubQuery', () => {
  test('defaults', () => {
    assert({
      given: 'no parameters',
      should: 'plan twenty minutes with nothing done',
      actual: parseHubQuery({}),
      expected: defaultHubQuery,
    });
  });

  test('valid values', () => {
    assert({
      given: 'ten minutes and two finished items, out of order',
      should: 'keep them in plan order',
      actual: parseHubQuery({ mins: '10', did: 'impact-drill,review' }),
      expected: { mins: 10, did: ['review', 'impact-drill'] },
    });
  });

  test('bad values', () => {
    assert({
      given: 'an unknown time, unknown items and a repeated parameter',
      should: 'fall back to the defaults and drop unknown items',
      actual: parseHubQuery({
        mins: '15',
        did: ['nope,review,review', 'x'],
      }),
      expected: { mins: 20, did: ['review'] },
    });
  });
});

describe('hubHref', () => {
  test('carries only non-defaults', () => {
    assert({
      given: 'the default, a chosen time and finished items',
      should: 'omit defaults from the URL',
      actual: [
        hubHref(defaultHubQuery),
        hubHref({ mins: 10, did: [] }),
        hubHref({ mins: 20, did: ['review', 'impact-drill'] }),
      ],
      expected: [
        '/train',
        '/train?mins=10',
        '/train?did=review%2Cimpact-drill',
      ],
    });
  });
});

describe('withPlanContext', () => {
  test('appends the plan state to a flow link', () => {
    assert({
      given: 'links with and without a query, and the default plan',
      should: 'add only non-default plan state with the right separator',
      actual: [
        withPlanContext('/train/review', defaultHubQuery),
        withPlanContext('/train/review', { mins: 10, did: ['review'] }),
        withPlanContext('/train/drill?kind=impact', {
          mins: 20,
          did: ['review'],
        }),
      ],
      expected: [
        '/train/review',
        '/train/review?mins=10&did=review',
        '/train/drill?kind=impact&did=review',
      ],
    });
  });
});

describe('parseWelcomeGoal', () => {
  test('a chosen goal, a missing one and a bad one', () => {
    assert({
      given: 'goal=3, no goal and goal=4',
      should: 'return 3, then 0 for none or an unoffered goal',
      actual: [
        parseWelcomeGoal({ goal: '3' }),
        parseWelcomeGoal({}),
        parseWelcomeGoal({ goal: '4' }),
      ],
      expected: [3, 0, 0],
    });
  });
});

describe('withDone', () => {
  test('adds an item once, in plan order', () => {
    assert({
      given: 'review done, then the impact drill added twice',
      should: 'list both once in plan order and leave mins alone',
      actual: withDone(
        withDone({ mins: 10, did: ['impact-drill'] }, 'review'),
        'impact-drill',
      ),
      expected: { mins: 10, did: ['review', 'impact-drill'] },
    });
  });
});
