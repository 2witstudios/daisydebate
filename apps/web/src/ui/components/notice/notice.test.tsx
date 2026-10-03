import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Notice } from './notice';

setupRitewayBun();

describe('Notice', () => {
  test('a titled note', () => {
    const html = renderToString(
      h(Notice, { tone: 'gold', icon: 'alert', title: 'Heads up' }, 'Body'),
    );
    assert({
      given: 'a gold notice with a title and body',
      should: 'show both and carry no live role',
      actual: [
        html.includes('Heads up'),
        html.includes('Body'),
        html.includes('role='),
      ],
      expected: [true, true, false],
    });
  });

  test('an answer', () => {
    const html = renderToString(
      h(Notice, {
        tone: 'accent',
        icon: 'check',
        title: 'Saved',
        role: 'status',
      }),
    );
    assert({
      given: 'a notice marked as a status without a body',
      should: 'announce as a status and render no paragraph body',
      actual: [html.includes('role="status"'), html.split('<p ').length - 1],
      expected: [true, 1],
    });
  });
});
