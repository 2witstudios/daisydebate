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

  test('inert actions explain themselves', () => {
    assert({
      given: 'every inert action',
      should: 'carry a label and a full-sentence reason',
      actual: Object.values(inertActions).every(
        ({ label, reason }) =>
          label.length > 0 && reason.length > 0 && reason.endsWith('.'),
      ),
      expected: true,
    });
  });
});
