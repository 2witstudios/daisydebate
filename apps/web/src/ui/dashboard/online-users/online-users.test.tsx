import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { OnlineUsers } from './online-users';
import { createInitialState } from '../../store/state';
import { setUiState } from '../../store/store';
import { iconButtonClass } from '../../components/icon-button/icon-button-class';

setupRitewayBun();

const seed = createInitialState();

describe('OnlineUsers', () => {
  test('renders the roster and count from the store', () => {
    setUiState({
      resources: { ...seed.resources, onlineCount: 23456 },
      collections: {
        ...seed.collections,
        onlineUsers: [
          { name: 'Ada Byron', tier: 'master', rating: 2100, presence: 'away' },
        ],
      },
    });
    const html = renderToString(h(OnlineUsers));
    assert({
      given: 'a store with one away master and 23456 online',
      should: 'show the grouped count, the user, tier label, and presence',
      actual: [
        html.includes('Online (23,456)'),
        html.includes('Ada Byron'),
        html.includes('Master'),
        html.includes('aria-label="away"'),
        html.includes('Alex Chen'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('names each challenge button after its user', () => {
    setUiState(seed);
    const html = renderToString(h(OnlineUsers));
    assert({
      given: 'the seeded roster',
      should: 'expose one uniquely named challenge action per user',
      actual: seed.collections.onlineUsers.filter(
        (user) => !html.includes(`aria-label="Challenge ${user.name}"`),
      ),
      expected: [],
    });
  });

  test('reveals each challenge button with its row', () => {
    setUiState(seed);
    const html = renderToString(h(OnlineUsers));
    assert({
      given: 'the seeded roster',
      should:
        'style every challenge button with the reveal tone and nothing that overrides it',
      actual: [
        ...html.matchAll(
          /<button[^>]* class="([^"]*)"[^>]*aria-label="Challenge /g,
        ),
      ].filter((match) => match[1] !== iconButtonClass('reveal')).length,
      expected: 0,
    });
  });
});
