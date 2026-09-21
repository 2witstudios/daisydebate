import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Topbar } from './topbar';
import { createInitialState } from '../../../../store/state';
import { setUiState } from '../../../../store/store';

setupRitewayBun();

const seed = createInitialState();

const renderWith = (notificationsCount: number): string => {
  setUiState({
    ...seed,
    resources: {
      ...seed.resources,
      notificationsCount,
      viewer: { name: 'Ada Byron', tier: 'master', rating: 2100 },
    },
  });
  return renderToString(h(Topbar));
};

describe('Topbar', () => {
  test('is the banner with a home brand link and labelled controls', () => {
    const html = renderWith(3);
    assert({
      given: 'the topbar',
      should: 'render a header, link the brand home, and name its controls',
      actual: [
        html.includes('<header'),
        /<a [^>]*href="\/"/.test(html),
        html.includes('aria-label="Notifications"'),
        html.includes('type="search"'),
        html.includes('aria-label="Search"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('shows the viewer identity from the store', () => {
    const html = renderWith(3);
    assert({
      given: 'a master-tier viewer rated 2100',
      should: 'render the name, rating, tier label, and online presence',
      actual: [
        html.includes('Ada Byron'),
        html.includes('2100'),
        html.includes('Master'),
        html.includes('aria-label="online"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('shows the notification badge only when something is unread', () => {
    const badge = (html: string): string | undefined =>
      /<span[^>]* aria-hidden="true">(\d+)<\/span>/.exec(html)?.[1];
    assert({
      given: 'three and then zero unread notifications',
      should: 'render the count badge only for the unread case',
      actual: [badge(renderWith(3)), badge(renderWith(0))],
      expected: ['3', undefined],
    });
  });
});
