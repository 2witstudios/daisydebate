import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { OnlineUsers } from './online-users';
import { createInitialState, type UiState } from '../../store/state';
import { UiStoreProvider } from '../../store/store';
import { iconButtonClass } from '../../components/icon-button/icon-button-class';

setupRitewayBun();

const seed = createInitialState();

describe('OnlineUsers', () => {
  test('renders the roster and count from the store', () => {
    const initialState: UiState = {
      resources: { ...seed.resources, onlineCount: 23456 },
      collections: {
        ...seed.collections,
        onlineUsers: [
          { name: 'Ada Byron', tier: 'master', rating: 2100, presence: 'away' },
        ],
      },
    };
    const html = renderToString(
      h(UiStoreProvider, { initialState, children: h(OnlineUsers) }),
    );
    assert({
      given: 'a store with one away master and 23456 online',
      should:
        'show the grouped count, the user, tier label, presence, and a real See All link',
      actual: [
        html.includes('Online (23,456)'),
        html.includes('Ada Byron'),
        html.includes('Master'),
        html.includes('aria-label="away"'),
        html.includes('Alex Chen'),
        /<a [^>]*aria-label="See all online users"[^>]*href="\/lobby"/.test(
          html,
        ),
      ],
      expected: [true, true, true, true, false, true],
    });
  });

  test('names each challenge link after its user, pointing at a real route', () => {
    const html = renderToString(
      h(UiStoreProvider, { initialState: seed, children: h(OnlineUsers) }),
    );
    assert({
      given: 'the seeded roster',
      should: 'expose one uniquely named challenge link to /play per user',
      actual: seed.collections.onlineUsers.filter(
        (user) =>
          !html.includes(
            `<a class="${iconButtonClass('reveal')}" aria-label="Challenge ${user.name}" title="Challenge ${user.name}" href="/play"`,
          ),
      ),
      expected: [],
    });
  });
});
