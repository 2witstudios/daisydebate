import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Panel } from './panel';
import { Button } from '../button/button';

setupRitewayBun();

describe('Panel', () => {
  test('renders a titled panel body', () => {
    const html = renderToString(
      h(Panel, {
        title: 'Recent Activity',
        children: h('p', null, 'body'),
      }),
    );
    assert({
      given: 'a titled panel',
      should: 'render a heading followed by the body',
      actual: [html.includes('Recent Activity'), html.includes('<p>body</p>')],
      expected: [true, true],
    });
  });

  test('renders the trailing header action when provided', () => {
    const html = renderToString(
      h(Panel, {
        title: 'Online',
        action: h(Button, { variant: 'ghost', children: 'See All' }),
        children: h('p', null, 'body'),
      }),
    );
    assert({
      given: 'a panel with a header action',
      should: 'render the action in the header',
      actual: html.includes('See All'),
      expected: true,
    });
  });

  test('renders an optional header icon', () => {
    const withIcon = renderToString(
      h(Panel, {
        title: 'Online',
        icon: 'person',
        children: h('p', null, 'b'),
      }),
    );
    const withoutIcon = renderToString(
      h(Panel, { title: 'Online', children: h('p', null, 'b') }),
    );
    assert({
      given: 'panels with and without an icon',
      should: 'render the icon only when provided',
      actual: [withIcon.includes('svg'), withoutIcon.includes('<svg')],
      expected: [true, false],
    });
  });
});
