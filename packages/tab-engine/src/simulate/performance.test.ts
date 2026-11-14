import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { measure } from '../../scripts/performance-cases';

setupRitewayBun();

describe('performance', () => {
  test('each method runs within its typical target, with room for a slower machine', () => {
    const slow = measure().filter((m) => m.ms > m.targetMs * 3);
    assert({
      given: 'the typical sizes of the plan, best of three runs',
      should:
        'run each within three times its laptop target (the long run reports the exact figures)',
      actual: slow,
      expected: [],
    });
  });
});
