import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refreshOnSchedule } from './use-ballot-refresh';

setupRitewayBun();

/** One timeout at most, fired by hand, and a page shown or hidden by hand. */
const manualEdges = () => {
  let run: (() => void) | null = null;
  let visible = true;
  let listeners: (() => void)[] = [];
  const delays: number[] = [];
  return {
    delays,
    armed: () => run !== null,
    listening: () => listeners.length,
    fire: () => {
      const due = run;
      run = null;
      due?.();
    },
    show: (shown: boolean) => {
      visible = shown;
      for (const listener of listeners) listener();
    },
    edges: {
      setTimeout: (callback: () => void, inMs: number) => {
        run = callback;
        delays.push(inMs);
        return delays.length;
      },
      clearTimeout: () => {
        run = null;
      },
      visible: () => visible,
      onVisibilityChange: (listener: () => void) => {
        listeners = [...listeners, listener];
        return () => {
          listeners = listeners.filter((kept) => kept !== listener);
        };
      },
    },
  };
};

/** A schedule whose delay is read from `nextInMs` at the present; firing advances the present by the delay. */
const started = (
  nextInMs: (nowMs: number) => number | null,
  { hidden = false } = {},
) => {
  const browser = manualEdges();
  if (hidden) browser.show(false);
  let nowMs = 0;
  let refreshes = 0;
  const stop = refreshOnSchedule({
    nextInMs,
    nowMs: () => nowMs,
    refresh: () => (refreshes += 1),
    edges: browser.edges,
  });
  const pass = (timeouts: number) => {
    for (let passed = 0; passed < timeouts; passed += 1) {
      nowMs += browser.delays.at(-1) ?? 0;
      browser.fire();
    }
    return refreshes;
  };
  return { browser, pass, stop, refreshes: () => refreshes };
};

test('refreshing runs until there is no next refresh', () => {
  const { browser, pass } = started((at) => (at < 15_000 ? 5_000 : null));
  assert({
    given:
      'a page refreshed every five seconds for fifteen, with no new props in that time',
    should:
      'refresh on the first two, stop itself at the third and never refresh again',
    actual: [pass(2), browser.armed(), pass(3), browser.armed()],
    expected: [2, true, 2, false],
  });
});

test('each refresh is scheduled by the delay named at that moment', () => {
  const { browser, pass } = started((at) => 5_000 + at);
  const refreshed = pass(3);
  assert({
    given: 'a delay that grows with the present',
    should: 'wait the delay named when each refresh was sent',
    actual: [refreshed, browser.delays],
    expected: [3, [5_000, 10_000, 20_000, 40_000]],
  });
});

test('a page with no next refresh starts no timer', () => {
  const { browser, pass } = started(() => null);
  assert({
    given: 'a page with no next refresh when it mounts',
    should: 'start no timer and never refresh',
    actual: [browser.delays, pass(2)],
    expected: [[], 0],
  });
});

test('leaving the page stops the refreshing', () => {
  const { browser, pass, stop } = started(() => 5_000);
  const before = pass(1);
  stop();
  assert({
    given: 'a refreshing page that is left',
    should: 'refresh no more and stop watching whether it is shown',
    actual: [before, browser.armed(), pass(2), browser.listening()],
    expected: [1, false, 1, 0],
  });
});

test('a hidden page is not refreshed, and is refreshed at once when shown', () => {
  const { browser, pass, refreshes } = started(() => 5_000);
  browser.show(false);
  const hidden = [browser.armed(), pass(2)];
  browser.show(true);
  assert({
    given: 'a refreshing page hidden, then shown again',
    should:
      'hold no timer and refresh nothing while hidden, then refresh at once and go on',
    actual: [hidden, refreshes(), browser.armed(), pass(1)],
    expected: [[false, 0], 1, true, 2],
  });
});

test('a page opened hidden waits to be shown', () => {
  const { browser, pass, refreshes } = started(() => 5_000, { hidden: true });
  const hidden = [browser.delays.length, pass(1)];
  browser.show(true);
  assert({
    given: 'a page that mounts in a hidden tab, then is shown',
    should: 'start no timer until it is shown, then refresh and go on',
    actual: [hidden, refreshes(), browser.armed()],
    expected: [[0, 0], 1, true],
  });
});

test('a page with no next refresh is not refreshed for being shown', () => {
  const { browser, refreshes } = started(() => null);
  browser.show(false);
  browser.show(true);
  assert({
    given: 'a page with no next refresh, hidden and shown again',
    should: 'refresh nothing and start no timer',
    actual: [refreshes(), browser.armed()],
    expected: [0, false],
  });
});
