import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AUTO_RETRY_DELAY_MS, startAutoRetry } from './auto-retry';
import { fakeVisibility } from '../../ui/test-support/fake-visibility';

setupRitewayBun();

function harness(hidden = false) {
  let fire: (() => void) | undefined;
  let retries = 0;
  let timers = 0;
  const delays: number[] = [];
  const page = fakeVisibility(hidden);
  const stop = startAutoRetry({
    visibility: page.visibility,
    after: (run, delay) => {
      delays.push(delay);
      fire = run;
      timers += 1;
      return () => {
        timers -= 1;
        fire = undefined;
      };
    },
    retry: () => {
      retries += 1;
    },
  });
  return {
    stop,
    fire: () => fire?.(),
    lateFire: () => fire,
    change: page.change,
    snapshot: () => ({
      retries,
      timers,
      listeners: page.listeners(),
      delays: [...delays],
    }),
  };
}

describe('error boundary auto-retry', () => {
  test('a visible page retries once after the delay', () => {
    const page = harness();
    page.fire();
    assert({
      given: 'a failed render on a visible page whose timer fires',
      should: 'retry once and release the listener',
      actual: page.snapshot(),
      expected: {
        retries: 1,
        timers: 0,
        listeners: 0,
        delays: [AUTO_RETRY_DELAY_MS],
      },
    });
  });

  test('a hidden page waits until it is shown', () => {
    const page = harness(true);
    const before = page.snapshot();
    page.change(false);
    page.fire();
    assert({
      given: 'a failed render in a background tab that is later shown',
      should: 'schedule nothing while hidden, then retry once when visible',
      actual: { before, after: page.snapshot() },
      expected: {
        before: { retries: 0, timers: 0, listeners: 1, delays: [] },
        after: {
          retries: 1,
          timers: 0,
          listeners: 0,
          delays: [AUTO_RETRY_DELAY_MS],
        },
      },
    });
  });

  test('hiding the page cancels a pending retry', () => {
    const page = harness();
    page.change(true);
    assert({
      given: 'a scheduled retry and then the tab going to the background',
      should: 'cancel the timer without retrying',
      actual: page.snapshot(),
      expected: {
        retries: 0,
        timers: 0,
        listeners: 1,
        delays: [AUTO_RETRY_DELAY_MS],
      },
    });
  });

  test('stopping cancels the retry and ignores late timers', () => {
    const page = harness();
    const late = page.lateFire();
    page.stop();
    late?.();
    page.stop();
    assert({
      given: 'an unmounted boundary and a timer callback that still runs',
      should: 'never retry and leave no timer or listener behind',
      actual: page.snapshot(),
      expected: {
        retries: 0,
        timers: 0,
        listeners: 0,
        delays: [AUTO_RETRY_DELAY_MS],
      },
    });
  });
});
