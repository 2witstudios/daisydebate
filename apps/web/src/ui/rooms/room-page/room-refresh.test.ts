import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fakeVisibility } from '../../test-support/fake-visibility';
import { startRoomRefresh } from './room-refresh';

setupRitewayBun();

function harness(hidden = false) {
  let tick: (() => void) | undefined;
  let refreshes = 0;
  const delays: number[] = [];
  let timers = 0;
  const page = fakeVisibility(hidden);
  const stop = startRoomRefresh({
    visibility: page.visibility,
    every: (callback, delay) => {
      delays.push(delay);
      tick = callback;
      timers += 1;
      return () => {
        timers -= 1;
        tick = undefined;
      };
    },
    refresh: () => {
      refreshes += 1;
    },
  });
  return {
    stop,
    tick: () => tick?.(),
    change: page.change,
    snapshot: () => ({
      refreshes,
      timers,
      listeners: page.listeners(),
      delays,
    }),
    lateTick: () => tick,
  };
}

describe('room server refresh lifecycle', () => {
  test('visible pages reread server state every five seconds', () => {
    const page = harness();
    page.tick();
    page.tick();
    assert({
      given: 'a visible room page and two scheduled ticks',
      should: 'request two server refreshes through one five-second timer',
      actual: page.snapshot(),
      expected: { refreshes: 2, timers: 1, listeners: 1, delays: [5000] },
    });
    page.stop();
  });

  test('hidden pages schedule no server reads', () => {
    const page = harness(true);
    page.tick();
    assert({
      given: 'a room mounted in a hidden tab',
      should: 'wait for visibility without scheduling or fetching',
      actual: page.snapshot(),
      expected: { refreshes: 0, timers: 0, listeners: 1, delays: [] },
    });
    page.stop();
  });

  test('visibility changes cancel and resume one timer', () => {
    const page = harness();
    const queued = page.lateTick();
    page.change(true);
    queued?.();
    page.change(false);
    page.change(false);
    page.tick();
    assert({
      given: 'a hidden tab with a queued tick, then two visible events',
      should: 'ignore the hidden tick, catch up once and keep one timer',
      actual: page.snapshot(),
      expected: { refreshes: 2, timers: 1, listeners: 1, delays: [5000, 5000] },
    });
    page.stop();
  });

  test('departure prevents late callbacks and is idempotent', () => {
    const page = harness();
    const queued = page.lateTick();
    page.stop();
    page.stop();
    queued?.();
    page.change(false);
    assert({
      given: 'an unmounted room, repeated disposal and a queued callback',
      should: 'leave no timers or listeners and request no server data',
      actual: page.snapshot(),
      expected: { refreshes: 0, timers: 0, listeners: 0, delays: [5000] },
    });
  });
});
