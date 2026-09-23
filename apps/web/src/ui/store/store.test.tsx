import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createInitialState, type UiState } from './state';
import { createUiStore, useUiState, UiStoreProvider } from './store';
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
    const store = createUiStore(state);
    let notifications = 0;
    const unsubscribe = store.subscribeUiState(() => {
      notifications += 1;
    });
    store.setUiState(state);
    const next = transactions.setSearchQuery(state, 'ranked');
    store.setUiState(next);
    unsubscribe();
    store.setUiState(transactions.setSearchQuery(next, 'elo'));
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
    const html = renderToString(
      h(UiStoreProvider, {
        initialState: createInitialState(),
        children: h(Probe),
      }),
    );
    assert({
      given: 'a component reading the store rendered to string',
      should: 'render the seeded content through the server snapshot',
      actual: html,
      expected: '<p>Alex Chen:empty</p>',
    });
  });
});

/**
 * A concurrent server request: create a store the way UiStoreProvider does,
 * yield to the event loop (standing in for another request's I/O
 * interleaving on the same process), write to it, yield again, then read.
 * `Promise.all` below runs two of these with overlapping awaits, so their
 * bodies genuinely interleave rather than running one after the other.
 */
async function simulateRequest(
  store: { getUiState: () => UiState; setUiState: (next: UiState) => void },
  query: string,
): Promise<string> {
  await Promise.resolve();
  store.setUiState(transactions.setSearchQuery(store.getUiState(), query));
  await Promise.resolve();
  return store.getUiState().resources.searchQuery;
}

describe('UI store request scoping (ADR 0024)', () => {
  test('two concurrent renders never see each other state', async () => {
    const requestA = createUiStore(createInitialState());
    const requestB = createUiStore(createInitialState());
    const [queryA, queryB] = await Promise.all([
      simulateRequest(requestA, 'alpha'),
      simulateRequest(requestB, 'beta'),
    ]);
    assert({
      given: 'two concurrent requests, each with its own store instance',
      should: 'each keep only the query it wrote itself',
      actual: [queryA, queryB],
      expected: ['alpha', 'beta'],
    });
  });

  test('negative control: a module-global store leaks between concurrent requests', async () => {
    // Reproduces the defect this ADR 0024 change fixes: apps/web's old
    // store.ts kept `let state` at module scope, so every request read and
    // wrote the same object. Modelled locally (the module itself is gone)
    // to document, permanently, why a shared instance is unsafe.
    let globalState = createInitialState();
    const globalStore = {
      getUiState: () => globalState,
      setUiState: (next: UiState) => {
        globalState = next;
      },
    };
    const [queryA, queryB] = await Promise.all([
      simulateRequest(globalStore, 'alpha'),
      simulateRequest(globalStore, 'beta'),
    ]);
    assert({
      given: 'two concurrent requests sharing one module-global store',
      should: 'cross-contaminate: both observe whichever write ran last',
      actual: [queryA === queryB, new Set([queryA, queryB]).size],
      expected: [true, 1],
    });
  });

  test('UiStoreProvider gives each render its own store instance', () => {
    const stateA = { ...createInitialState() };
    const stateB = {
      ...createInitialState(),
      resources: {
        ...createInitialState().resources,
        searchQuery: 'from-b',
      },
    };
    const htmlA = renderToString(
      h(UiStoreProvider, { initialState: stateA, children: h(Probe) }),
    );
    const htmlB = renderToString(
      h(UiStoreProvider, { initialState: stateB, children: h(Probe) }),
    );
    assert({
      given: 'two provider trees rendered with different seeded state',
      should: 'render each tree from its own store, not a shared one',
      actual: [htmlA, htmlB],
      expected: ['<p>Alex Chen:empty</p>', '<p>Alex Chen:from-b</p>'],
    });
  });
});
