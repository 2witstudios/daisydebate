import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Notice } from './notice';

setupRitewayBun();

describe('Notice', () => {
  test('an icon and its text', () => {
    const html = renderToString(h(Notice, { children: 'Unrated.' }));
    assert({
      given: 'a notice',
      should: 'show a decorative icon and the text',
      actual: [html.includes('<svg'), html.includes('Unrated.')],
      expected: [true, true],
    });
  });
});
