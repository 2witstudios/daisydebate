import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../test-support/rendered/accessible';
import ErrorBoundary from './error';

setupRitewayBun();

describe('ErrorBoundary', () => {
  test('offers the retry as a button', () => {
    const view = renderAccessible(
      h(ErrorBoundary, {
        error: Object.assign(new Error('boom'), { digest: 'd1' }),
        retry: () => undefined,
      }),
    );
    assert({
      given: 'a route error',
      should: 'render "Try again" as a button (its styling: markup-contracts)',
      actual: view.has('button', 'Try again'),
      expected: true,
    });
  });
});
