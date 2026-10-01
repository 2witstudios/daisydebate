import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PageHeader } from '../../components/page-header/page-header';
import { PageFrame, PageTitle } from './page-frame';

setupRitewayBun();

describe('PageFrame and PageHeader', () => {
  test('one h1 with lede and actions inside the column', () => {
    const html = renderToString(
      h(PageFrame, {
        children: h(PageHeader, {
          title: 'Tournaments',
          lede: 'Events.',
          actions: h('a', { href: '/x' }, 'Go'),
        }),
      }),
    );
    assert({
      given: 'a framed header with lede and action',
      should: 'render one h1, the lede and the action',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Events.'),
        html.includes('>Go<'),
        html.includes('max-w-dash-column'),
      ],
      expected: [1, true, true, true],
    });
  });
});

describe('PageTitle', () => {
  test('breadcrumb, one h1 with badges, then the lede', () => {
    const html = renderToString(
      h(PageTitle, {
        trail: [
          { label: 'Tournaments', href: '/tournaments' },
          { label: 'Cup' },
        ],
        title: 'Cup',
        badges: h('span', null, 'Live'),
        children: h('p', null, 'Lede.'),
      }),
    );
    assert({
      given: 'a trail, a title, a badge and a lede',
      should: 'render them in that order with one h1',
      actual: [
        html.match(/<h1 /g)?.length,
        html.indexOf('Breadcrumb') < html.indexOf('<h1'),
        html.indexOf('<h1') < html.indexOf('Live'),
        html.indexOf('Live') < html.indexOf('Lede.'),
      ],
      expected: [1, true, true, true],
    });
  });
});
