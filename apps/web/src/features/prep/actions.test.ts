import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inertActions, prepDestinations } from './actions';

setupRitewayBun();

describe('prep actions', () => {
  test('destinations are local paths', () => {
    assert({
      given: 'every Prep destination',
      should: 'be a path under /prep',
      actual: Object.values(prepDestinations).every((path) =>
        path.startsWith('/prep'),
      ),
      expected: true,
    });
  });

  test('inert actions are named', () => {
    assert({
      given: 'every inert action',
      should: 'carry a label for the control and the shell banner',
      actual: Object.values(inertActions).every(
        ({ label }) => label.length > 0,
      ),
      expected: true,
    });
  });
});
