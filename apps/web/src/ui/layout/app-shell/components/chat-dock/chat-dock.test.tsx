import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderInStore } from '../../../../test-support/render-in-store';
import type { ShellAccount } from '../topbar/topbar';
import { ChatDock } from './chat-dock';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };
const render = (account: ShellAccount) =>
  renderInStore(h(ChatDock, { account }));

describe('ChatDock', () => {
  test('a column with its own header, your status and a way to collapse it', () => {
    const html = render(member);
    assert({
      given: 'a signed-in member',
      should:
        'render the friends column with your status and a close button, and no bottom bar',
      actual: [
        html.includes('id="friends-dock"'),
        html.includes('aria-label="Friends"'),
        html.includes('You are online'),
        html.includes('aria-label="Close friends"'),
        html.includes('<details'),
        html.includes('<summary'),
      ],
      expected: [true, true, true, true, false, false],
    });
  });

  test('grouped, with what you can do', () => {
    const html = render(member);
    assert({
      given: 'the column',
      should:
        'list people by status with Watch and Challenge links, debating first',
      actual: [
        html.includes('dock-panel'),
        html.indexOf('>In a debate</h3>') < html.indexOf('>Online</h3>'),
        html.includes('href="/watch"'),
        html.includes('href="/play/room"'),
        html.includes('href="/profile/alex-chen"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('nothing for a visitor or someone mid sign-up', () => {
    assert({
      given: 'an anonymous visitor and a provisional account',
      should: 'render nothing',
      actual: [
        render({ state: 'anonymous' }),
        render({ state: 'provisional' }),
      ],
      expected: ['', ''],
    });
  });
});
