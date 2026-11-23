import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../test-support/rendered/accessible';
import GlobalError from './global-error';

setupRitewayBun();

/** The server render of a root-layout failure carrying digest d1, by role. */
const renderFailure = () =>
  renderAccessible(
    h(GlobalError, {
      error: Object.assign(new Error('boom'), { digest: 'd1' }),
      retry: () => undefined,
    }),
  );

describe('GlobalError', () => {
  test('names the failure by its correlation identifier', () => {
    const view = renderFailure();
    assert({
      given: 'a root-layout failure carrying digest d1',
      should: 'say the failure was recorded with that identifier',
      actual: view
        .within('main')
        .textContent()
        .includes('recorded with correlation identifier d1.'),
      expected: true,
    });
  });

  test('offers the retry as a button', () => {
    const view = renderFailure();
    assert({
      given: 'a root-layout failure',
      should: 'render "Try again" as a button (its styling: markup-contracts)',
      actual: view.has('button', 'Try again'),
      expected: true,
    });
  });

  test('offers a way to contact support', () => {
    assert({
      given: 'a root-layout failure',
      should: 'link to /support',
      actual: renderFailure().includes(
        '<a href="/support">Contact support</a>',
      ),
      expected: true,
    });
  });
});
