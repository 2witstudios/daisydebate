import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ScopeToggle } from './scope-toggle';

setupRitewayBun();

describe('ScopeToggle', () => {
  test('two radios in one group, the value checked', () => {
    const view = renderAccessible(h(ScopeToggle, { value: 'mine' }));
    const group = view.within('group', 'Whose recordings');
    assert({
      given: 'the my-debates scope',
      should: 'render radios named scope with My Rounds checked',
      actual: [
        group.all('radio').map((radio) => radio.getAttribute('name')),
        group.names('radio', { checked: true }),
        group.attribute('radio', 'My debates', 'value'),
      ],
      expected: [['scope', 'scope'], ['My debates'], 'mine'],
    });
  });
});
