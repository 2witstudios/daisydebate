import { assert, setupRitewayBun, test } from 'riteway/bun';
import scenario from '../scenarios/disconnect-rejoin';
import { runScenario } from './scenario';
setupRitewayBun();
test('disconnect-rejoin verifies actual opening, outage extension and first timely reconnect receipt', () => {
  assert({
    given:
      'actual shared runtime with deterministic disconnected/rejoined receipt evidence',
    should: 'remain active after recovery rather than inventing a forfeit',
    actual: runScenario(scenario),
    expected: scenario.expect,
  });
  let failure = '';
  try {
    runScenario({
      ...scenario,
      verify: () => {
        throw new Error('Rejected attendance proof');
      },
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Unexpected error';
  }
  assert({
    given: 'a failing attached attendance proof',
    should: 'fail the scenario rather than reporting a boundary as success',
    actual: failure,
    expected: 'Rejected attendance proof',
  });
});
