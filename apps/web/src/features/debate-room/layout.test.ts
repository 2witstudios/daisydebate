import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { tileHeightFor } from './layout';

setupRitewayBun();

describe('tileHeightFor', () => {
  test('the video gives way when the debater needs the workspace', () => {
    assert({
      given: 'each phase of a Round',
      should:
        'show large tiles while listening or in cross-ex, smaller for your speech and ballots, and smallest in prep',
      actual: (
        [
          'opponent-speaking',
          'cross-ex',
          'own-speech',
          'judging',
          'waiting',
          'prep',
        ] as const
      ).map(tileHeightFor),
      expected: [200, 200, 120, 120, 120, 72],
    });
  });
});
