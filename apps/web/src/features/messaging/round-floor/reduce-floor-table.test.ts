import { assert, setupRitewayBun, test } from 'riteway/bun';
import { everyState, transitionsOf } from './floor-states.test-support';
import { TRANSITIONS } from './floor-transitions.test-support';

setupRitewayBun();

for (const [name, state, inFlight] of everyState())
  test(`every event in the state "${name}"`, () => {
    assert({
      given: `the state "${name}" and every event`,
      should: 'do what the table says, and reject what it does not list',
      actual: transitionsOf(state, inFlight),
      expected: TRANSITIONS[name],
    });
  });

test('the table covers every shape of state', () => {
  assert({
    given: 'the states the table lists and the states the tests can build',
    should: 'be the same states',
    actual: Object.keys(TRANSITIONS).sort(),
    expected: everyState()
      .map(([name]) => name)
      .sort(),
  });
});
