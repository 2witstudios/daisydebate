import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sessionIsAgent } from './agent-session';

setupRitewayBun();

describe('sessionIsAgent', () => {
  test('is true only for a fully autonomous run', () => {
    assert({
      given: 'DAISY_AUTONOMOUS=1, another value, and no value',
      should: 'treat only 1 as an autonomous agent session',
      actual: [
        sessionIsAgent({ DAISY_AUTONOMOUS: '1' }),
        sessionIsAgent({ DAISY_AUTONOMOUS: '0' }),
        sessionIsAgent({}),
      ],
      expected: [true, false, false],
    });
  });
});
