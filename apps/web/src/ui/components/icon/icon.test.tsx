import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Icon } from './icon';

setupRitewayBun();

describe('Icon', () => {
  test('exposes a labelled icon as an image role', () => {
    const view = renderAccessible(h(Icon, { name: 'trophy', label: 'Prize' }));
    assert({
      given: 'an icon with a label',
      should: 'render an image role with the accessible name',
      actual: view.has('img', 'Prize'),
      expected: true,
    });
  });
});
