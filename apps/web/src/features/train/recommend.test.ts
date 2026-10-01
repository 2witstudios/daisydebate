import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recommend } from './recommend';

setupRitewayBun();

describe('recommend', () => {
  test('a weak impact', () => {
    assert({
      given: 'an impact missing in 4 of 6 drills',
      should: 'recommend the impact drill and say why',
      actual: recommend({ part: 'impact', missing: 4, of: 6 }),
      expected: {
        part: 'impact',
        title: 'Impact drill',
        reason:
          'Your impact was missing or unclear in 4 of your last 6 drills. Two short rounds on saying why it matters, and to whom.',
        minutes: 8,
      },
    });
  });

  test('no weak spot', () => {
    assert({
      given: 'no weak spot yet',
      should: 'recommend nothing',
      actual: recommend(null),
      expected: null,
    });
  });

  test('each part has its own drill', () => {
    assert({
      given: 'each structure part as the weak spot',
      should: 'name a different drill for each',
      actual: (['claim', 'warrant', 'responding', 'impact'] as const).map(
        (part) => recommend({ part, missing: 1, of: 2 })?.title,
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
