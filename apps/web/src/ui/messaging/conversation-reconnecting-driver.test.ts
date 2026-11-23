import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import { createConversationReconnectingDriver } from './conversation-reconnecting-driver';

setupRitewayBun();

const page = 'https://daisy.test/messages/c1';
const start = (address = () => page) => {
  const clock = virtualClock();
  const { scheduler } = virtualBrowserTime(clock);
  const refreshes: number[] = [];
  const driver = createConversationReconnectingDriver({
    address,
    refresh: () => refreshes.push(clock.nowMs()),
    scheduler,
  });
  let changes = 0;
  driver.subscribe(() => changes++);
  /** The refreshed page answered: its read arrived and the transition ended. */
  const answered = () => {
    driver.transitionRan(true);
    driver.readFinished(new URL(`${page}?_rsc=1`));
    driver.transitionRan(false);
  };
  return { clock, driver, refreshes, changes: () => changes, answered };
};

describe('conversation reconnecting driver', () => {
  test('waits, doubling, and gives up after three reads', async () => {
    const { clock, driver, refreshes, changes, answered } = start();
    driver.refused('a', 1000, 'page-read');
    await clock.advance(1000);
    answered();
    driver.refused('b', 1000, 'page-read');
    await clock.advance(2000);
    answered();
    driver.refused('c', 1000, 'page-read');
    await clock.advance(4000);
    answered();
    const before = driver.readSnapshot();
    driver.refused('d', 1000, 'page-read');
    await clock.advance(60_000);
    assert({
      given: 'four refused answers, each read arriving',
      should: 'refresh at 1, 3 and 7 seconds, then be exhausted once',
      actual: {
        refreshes,
        before,
        after: driver.readSnapshot(),
        changes: changes(),
      },
      expected: {
        refreshes: [1000, 3000, 7000],
        before: { exhausted: false },
        after: { exhausted: true },
        changes: 1,
      },
    });
  });

  test('the wait is capped at ten seconds', async () => {
    const { clock, driver, refreshes } = start();
    driver.refused('a', 20_000, 'page-read');
    await clock.advance(10_000);
    assert({
      given: 'a refusal asking for twenty seconds',
      should: 'refresh at ten',
      actual: refreshes,
      expected: [10_000],
    });
  });

  test('an action render during a held refresh is buffered until it settles', async () => {
    const { clock, driver, refreshes } = start();
    driver.refused('a', 1000, 'page-read');
    await clock.advance(1000);
    driver.refused('b', 1000, 'action-render');
    await clock.advance(5000);
    const held = refreshes.length;
    driver.readFinished(new URL(`${page}?_rsc=1`));
    driver.transitionRan(false);
    await clock.advance(2000);
    assert({
      given: 'an action answer while the refresh is held',
      should: 'refresh again only after the held one settled, waiting 2 s',
      actual: { held, refreshes },
      expected: { held: 1, refreshes: [1000, 8000] },
    });
  });

  test('a read of another page or a running transition does not settle', async () => {
    const { clock, driver, refreshes } = start();
    driver.refused('a', 1000, 'page-read');
    await clock.advance(1000);
    driver.refused('b', 1000, 'action-render');
    driver.readFinished(new URL('https://daisy.test/messages/other?_rsc=1'));
    driver.transitionRan(true);
    driver.readFinished(new URL(`${page}?_rsc=1`));
    await clock.advance(29_999);
    const held = refreshes.length;
    await clock.advance(1 + 2000);
    assert({
      given: 'another page read, then this one while the transition runs',
      should: 'stay held until the thirty second limit',
      actual: { held, refreshes: refreshes.length },
      expected: { held: 1, refreshes: 2 },
    });
  });

  test('stop and dispose end the recovery', async () => {
    const stopped = start();
    stopped.driver.refused('a', 1000, 'page-read');
    stopped.driver.stop();
    await stopped.clock.advance(60_000);
    const disposed = start();
    disposed.driver.refused('a', 1000, 'page-read');
    disposed.driver.dispose();
    await disposed.clock.advance(60_000);
    assert({
      given: 'leaving the page, or the page unmounting',
      should: 'refresh nothing',
      actual: [stopped.refreshes, disposed.refreshes],
      expected: [[], []],
    });
  });

  test('a page whose address moved is not refreshed', async () => {
    let address = page;
    const { clock, driver, refreshes } = start(() => address);
    driver.refused('a', 1000, 'page-read');
    address = 'https://daisy.test/messages/other';
    await clock.advance(1000);
    address = page;
    driver.refused('b', 1000, 'page-read');
    await clock.advance(60_000);
    assert({
      given: 'the address changing during the wait',
      should: 'stop for good',
      actual: refreshes,
      expected: [],
    });
  });
});
