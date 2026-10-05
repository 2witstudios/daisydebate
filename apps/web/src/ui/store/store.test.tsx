import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createInitialState, type NavState, type UiState } from './state';
import { createUiStore, useUiState, UiStoreProvider } from './store';
import { transactions } from '../transactions';

setupRitewayBun();

describe('UI store state', () => {
  test('seeds collections and resources from the mock fixtures', () => {
    const state = createInitialState();
    assert({
      given: 'a freshly created UI state',
      should: 'seed six users, two live debates, and the resources',
      actual: [
        state.collections.onlineUsers.length,
        state.collections.liveDebates.length,
        state.resources.onlineCount,
        state.resources.tournament.name,
      ],
      expected: [6, 2, 1248, 'Global Debate Championship'],
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
});

describe('UI store transactions', () => {
  test('setNav changes only the sidebar', () => {
    const state = createInitialState();
    const next = transactions.setNav(state, 'collapsed');
    assert({
      given: 'the seeded state and a sidebar choice',
      should: 'start on auto, take the choice, and leave the dock alone',
      actual: [
        state.resources.nav,
        next.resources.nav,
        next.resources.dock === state.resources.dock,
      ],
      expected: ['auto', 'collapsed', true],
    });
  });

  test('setDock changes only the dock', () => {
    const state = createInitialState();
    const next = transactions.setDock(state, 'closed');
    assert({
      given: 'the seeded state and a dock choice',
      should: 'start on auto, take the choice, and leave the rest alone',
      actual: [
        state.resources.dock,
        next.resources.dock,
        next.resources.nav === state.resources.nav,
        state.resources.dock,
      ],
      expected: ['auto', 'closed', true, 'auto'],
    });
  });

  test('are pure: they return new state and leave the original untouched', () => {
    const state = createInitialState();
    const next = transactions.setNav(state, 'collapsed');
    assert({
      given: 'a nav transaction over seeded state',
      should: 'update the nav without mutating the original',
      actual: [next.resources.nav, state.resources.nav, next === state],
      expected: ['collapsed', 'auto', false],
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
    const next = transactions.setNav(state, 'collapsed');
    store.setUiState(next);
    unsubscribe();
    store.setUiState(transactions.setNav(next, 'auto'));
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
  const nav = useUiState((state) => state.resources.nav);
  const user = useUiState((state) => state.collections.onlineUsers[0]);
  return h('p', null, `${user?.name ?? 'none'}:${nav}`);
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
      expected: '<p>Alex Chen:auto</p>',
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
  nav: NavState,
): Promise<NavState> {
  await Promise.resolve();
  store.setUiState(transactions.setNav(store.getUiState(), nav));
  await Promise.resolve();
  return store.getUiState().resources.nav;
}

describe('UI store request scoping (ADR 0024)', () => {
  test('two concurrent renders never see each other state', async () => {
    const requestA = createUiStore(createInitialState());
    const requestB = createUiStore(createInitialState());
    const [navA, navB] = await Promise.all([
      simulateRequest(requestA, 'collapsed'),
      simulateRequest(requestB, 'auto'),
    ]);
    assert({
      given: 'two concurrent requests, each with its own store instance',
      should: 'each keep only the nav it wrote itself',
      actual: [navA, navB],
      expected: ['collapsed', 'auto'],
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
    const [navA, navB] = await Promise.all([
      simulateRequest(globalStore, 'collapsed'),
      simulateRequest(globalStore, 'auto'),
    ]);
    assert({
      given: 'two concurrent requests sharing one module-global store',
      should: 'cross-contaminate: both observe whichever write ran last',
      actual: [navA === navB, new Set([navA, navB]).size],
      expected: [true, 1],
    });
  });

  test('UiStoreProvider gives each render its own store instance', () => {
    const stateA = { ...createInitialState() };
    const stateB = {
      ...createInitialState(),
      resources: {
        ...createInitialState().resources,
        nav: 'collapsed' as const,
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
      expected: ['<p>Alex Chen:auto</p>', '<p>Alex Chen:collapsed</p>'],
    });
  });
});
