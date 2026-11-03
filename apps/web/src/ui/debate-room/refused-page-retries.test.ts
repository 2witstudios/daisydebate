import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRefusedPageRetries } from './refused-page-retries';

setupRitewayBun();

const world = () => {
  const waits: number[] = [];
  let refreshes = 0;
  let pending: (() => void) | null = null;
  const stop = startRefusedPageRetries({
    firstWaitMs: 3000,
    refresh: () => {
      refreshes++;
    },
    schedule: (next, waitMs) => {
      waits.push(waitMs);
      pending = next;
      return () => {
        pending = null;
      };
    },
  });
  return {
    stop,
    waits,
    refreshes: () => refreshes,
    fire: () => pending?.(),
    waiting: () => pending !== null,
  };
};

test('a refused page asks again less often, up to a bound', () => {
  const page = world();
  for (let tick = 0; tick < 4; tick++) page.fire();
  assert({
    given: 'four refusals in a row',
    should: 'refresh each time and double the wait up to ten seconds',
    actual: [page.refreshes(), page.waits],
    expected: [4, [3000, 6000, 10_000, 10_000, 10_000]],
  });
});

test('moving on stops the asking', () => {
  const page = world();
  page.stop();
  assert({
    given: 'a member leaving before the wait ends',
    should: 'cancel it, so nothing refreshes',
    actual: [page.waiting(), page.refreshes()],
    expected: [false, 0],
  });
});
