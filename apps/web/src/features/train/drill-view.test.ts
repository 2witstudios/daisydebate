import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { drillScreen, parseDrillQuery, roundsFor } from './drill-view';

setupRitewayBun();

describe('parseDrillQuery', () => {
  test('defaults to the impact drill, round 1', () => {
    assert({
      given: 'no parameters',
      should: 'be the impact drill, round 1, default plan',
      actual: parseDrillQuery({}),
      expected: { kind: 'impact', round: 1, plan: { mins: 20, did: [] } },
    });
  });

  test('values, and bad values falling back', () => {
    assert({
      given: 'a responding drill, round 2, then nonsense',
      should: 'read the first and default the second',
      actual: [
        parseDrillQuery({ kind: 'responding', round: '2' }),
        parseDrillQuery({ kind: 'nope', round: 'x' }),
      ],
      expected: [
        { kind: 'responding', round: 2, plan: { mins: 20, did: [] } },
        { kind: 'impact', round: 1, plan: { mins: 20, did: [] } },
      ],
    });
  });

  test('the round is held to the plan', () => {
    assert({
      given:
        'round 2 and round 9 in a ten minute plan (one round) and a long one',
      should: 'clamp to the rounds the plan allows',
      actual: [
        parseDrillQuery({ round: '2', mins: '10' }).round,
        parseDrillQuery({ round: '9' }).round,
        parseDrillQuery({ round: '0' }).round,
        roundsFor({ mins: 10, did: [] }),
        roundsFor({ mins: 40, did: [] }),
      ],
      expected: [1, 2, 1, 1, 2],
    });
  });
});

describe('drillScreen', () => {
  test('round one of two points at the next round', () => {
    const screen = drillScreen(parseDrillQuery({ kind: 'impact' }));
    assert({
      given: 'the first of two impact rounds',
      should: 'show its prompt and offer another drill after saving',
      actual: [
        screen.title,
        screen.motion,
        screen.task,
        `${screen.round} of ${screen.rounds}`,
        screen.progress,
        screen.afterSave,
      ],
      expected: [
        'Impact drill',
        'Cities should fund public transit before roads.',
        'You are Aff. Argue that access comes first.',
        '1 of 2',
        0,
        { label: 'Another drill', href: '/train/drill?kind=impact&round=2' },
      ],
    });
  });

  test('the last round returns to the plan with the drill done', () => {
    const screen = drillScreen(
      parseDrillQuery({ kind: 'responding', round: '2', did: 'review' }),
    );
    assert({
      given: 'the last responding round with review done',
      should: 'go back to a hub with the responding drill done too',
      actual: [
        screen.title,
        screen.progress,
        screen.afterSave,
        screen.reviewHref,
      ],
      expected: [
        'Responding drill',
        50,
        {
          label: 'Back to Train',
          href: '/train?did=review%2Cresponding-drill',
        },
        '/train/review?did=review',
      ],
    });
  });

  test('every kind has a title', () => {
    assert({
      given: 'each kind',
      should: 'name its own drill',
      actual: (['claim', 'warrant', 'responding', 'impact'] as const).map(
        (kind) => drillScreen(parseDrillQuery({ kind })).title,
      ),
      expected: [
        'Claim drill',
        'Warrant drill',
        'Responding drill',
        'Impact drill',
      ],
    });
  });
});
