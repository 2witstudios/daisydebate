import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Panel } from './panel';
import { Button } from '../button/button';

setupRitewayBun();

describe('Panel', () => {
  test('renders a titled panel body', () => {
    const view = renderAccessible(
      h(Panel, {
        title: 'Recent Activity',
        children: h('p', null, 'body'),
      }),
    );
    assert({
      given: 'a titled panel',
      should: 'render a heading followed by the body',
      actual: [
        view.has('heading', 'Recent Activity'),
        view.text('paragraph'),
        view.textContent(),
      ],
      expected: [true, 'body', 'Recent Activitybody'],
    });
  });

  test('renders the trailing header action when provided', () => {
    const view = renderAccessible(
      h(Panel, {
        title: 'Online',
        action: h(Button, { variant: 'ghost', children: 'See All' }),
        children: h('p', null, 'body'),
      }),
    );
    assert({
      given: 'a panel with a header action',
      should: 'render the action in the header',
      actual: view.within('banner').has('button', 'See All'),
      expected: true,
    });
  });

  test('sets the title as a quiet eyebrow heading', () => {
    const view = renderAccessible(
      h(Panel, { title: 'Online', children: h('p', null, 'b') }),
    );
    assert({
      given: 'a panel title',
      should: 'render it as an h2',
      actual: view.has('heading', 'Online', { level: 2 }),
      expected: true,
    });
  });
});
