import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { SpectateRefusal } from './spectate-refusal';

setupRitewayBun();

describe('SpectateRefusal', () => {
  test('one answer', () => {
    const view = renderAccessible(h(SpectateRefusal));
    assert({
      given: 'a private or missing Round',
      should: 'say only that it is not available, with ways on',
      actual: [
        view.has('heading', 'This debate is not available', { level: 1 }),
        view.attribute('link', 'See live debates', 'href'),
        view.attribute('link', 'Browse recordings', 'href'),
      ],
      expected: [true, '/watch', '/recordings'],
    });
  });
});
