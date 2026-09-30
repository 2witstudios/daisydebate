import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LinkButton } from './link-button';

setupRitewayBun();

describe('LinkButton', () => {
  test('an anchor with the button look', () => {
    const html = renderToString(
      h(LinkButton, {
        href: '/tournaments',
        variant: 'primary',
        className: 'w-full',
        children: 'Go',
      }),
    );
    assert({
      given: 'a primary link button',
      should: 'be an anchor with the primary classes and no underline',
      actual: [
        html.startsWith('<a '),
        html.includes('href="/tournaments"'),
        html.includes('bg-accent'),
        html.includes('no-underline'),
        html.includes('w-full'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
