import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createInitialState } from './state';
import { setUiState, subscribeUiState, useUiState } from './store';
import { transactions } from '../transactions';

setupRitewayBun();

describe('UI store state', () => {
  test('seeds collections and resources from the mock fixtures', () => {
    const state = createInitialState();
    assert({
      given: 'a freshly created UI state',
      should:
        'seed six users, two live debates, four activities, and the resources',
      actual: [
        state.collections.onlineUsers.length,
        state.collections.liveDebates.length,
        state.collections.activities.length,
        state.resources.onlineCount,
        state.resources.tournament.name,
      ],
      expected: [6, 2, 4, 1248, 'Global Debate Championship'],
    });
  });

  test('joins debate participants with their ratings', () => {
    const state = createInitialState();
    assert({
      given: 'the first seeded live debate',
      should: 'carry both participants with their seeded ratings',
      actual: [
        state.collections.liveDebates[0]?.challenger,
        state.collections.liveDebates[0]?.challengerRating,
        state.collections.liveDebates[0]?.defenderRating,
      ],
      expected: ['Maya Singh', 1810, 1762],
    });
  });

  test('keeps system activities distinguishable from persona activities', () => {
    const state = createInitialState();
    assert({
      given: 'four seeded activities, one a system announcement',
      should: 'carry an actor name for exactly three',
      actual: state.collections.activities.filter((a) => a.actor !== null)
        .length,
      expected: 3,
    });
  });
});

describe('UI store transactions', () => {
  test('are pure: they return new state and leave the original untouched', () => {
    const state = createInitialState();
    const next = transactions.setSearchQuery(state, 'ranked');
    assert({
      given: 'a search transaction over seeded state',
      should: 'update the search query without mutating the original',
      actual: [
        next.resources.searchQuery,
        state.resources.searchQuery,
        next === state,
      ],
      expected: ['ranked', '', false],
    });
  });
});

describe('UI store snapshot subscription', () => {
  test('notifies subscribers only when the snapshot changes', () => {
    const state = createInitialState();
    setUiState(state);
    let notifications = 0;
    const unsubscribe = subscribeUiState(() => {
      notifications += 1;
    });
    setUiState(state);
    const next = transactions.setSearchQuery(state, 'ranked');
    setUiState(next);
    unsubscribe();
    setUiState(transactions.setSearchQuery(next, 'elo'));
    assert({
      given:
        'a subscriber across identical, changed, and post-unsubscribe swaps',
      should: 'notify once, only for the changed snapshot',
      actual: notifications,
      expected: 1,
    });
  });
});

function Probe() {
  const searchQuery = useUiState((state) => state.resources.searchQuery);
  const user = useUiState((state) => state.collections.onlineUsers[0]);
  return h(
    'p',
    null,
    `${user?.name ?? 'none'}:${searchQuery === '' ? 'empty' : searchQuery}`,
  );
}

describe('useUiState SSR snapshot', () => {
  test('renders the full state on the server (no hydration gaps)', () => {
    setUiState(createInitialState());
    const html = renderToString(h(Probe));
    assert({
      given: 'a component reading the store rendered to string',
      should: 'render the seeded content through the server snapshot',
      actual: html,
      expected: '<p>Alex Chen:empty</p>',
    });
  });
});
