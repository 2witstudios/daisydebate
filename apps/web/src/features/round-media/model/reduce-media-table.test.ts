import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ctx, everyEvent, everyState } from './media-driver.test-support';
import {
  eventName,
  transitionShape,
} from './media-transition-shape.test-support';
import { TRANSITIONS } from './media-transitions.test-support';
import { reduceMedia } from './reduce-media';

setupRitewayBun();

const tableOf = (
  state: typeof everyState extends () => readonly (readonly [string, infer S])[]
    ? S
    : never,
) => {
  const link = state.link as {
    connection?: number;
    reads?: { flight: { ticket: number } | null };
  };
  const cells: Record<string, string> = {};
  for (const event of everyEvent(
    link.connection ?? 999,
    link.reads?.flight?.ticket ?? 999,
    state.timers,
  )) {
    const step = reduceMedia(state, event, ctx);
    if (step.state !== state || step.effects.length > 0)
      cells[eventName(event)] = transitionShape(step.state, step.effects);
  }
  return cells;
};

for (const [name, state] of everyState())
  test(`every event in the state "${name}"`, () => {
    assert({
      given: `the state "${name}" and every event`,
      should: 'do what the table says, and reject what it does not list',
      actual: tableOf(state),
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
