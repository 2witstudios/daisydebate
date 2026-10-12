import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderInStore } from '../../test-support/render-in-store';
import { FriendsPage } from './friends-page';

setupRitewayBun();

describe('FriendsPage', () => {
  test('heads the page with how many are online', () => {
    const html = renderInStore(h(FriendsPage));
    assert({
      given: 'the seeded friends',
      should: 'title the page Friends with the online count',
      actual: [html.includes('>Friends</h1>'), />\d+ online</.test(html)],
      expected: [true, true],
    });
  });

  test('grouped, with what you can do', () => {
    const html = renderInStore(h(FriendsPage));
    assert({
      given: 'the seeded friends',
      should:
        'list people by status with Watch and Challenge links, debating first, each linking to a profile',
      actual: [
        html.indexOf('>In a debate</h2>') < html.indexOf('>Online</h2>'),
        html.includes('href="/watch"'),
        html.includes('href="/play/room"'),
        html.includes('href="/profile/alex-chen"'),
      ],
      expected: [true, true, true, true],
    });
  });
});
