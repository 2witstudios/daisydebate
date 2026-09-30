import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requirementFor } from '../access/decision';
import { judgeRoutes } from './routes';

setupRitewayBun();

describe('judgeRoutes', () => {
  test('every screen is guarded', () => {
    assert({
      given: 'each Judge route',
      should: 'need a participant, inherited from the /judge root',
      actual: Object.values(judgeRoutes).map(requirementFor),
      expected: Object.values(judgeRoutes).map(() => 'participant' as const),
    });
  });
});
