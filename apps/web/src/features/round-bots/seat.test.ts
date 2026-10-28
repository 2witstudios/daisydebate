import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotSeat } from './seat';
import { manualTimers } from '../../lib/worker-timers.test-support';
import { within } from './control-service.test-support';
setupRitewayBun();
function harness(withFeed: boolean, speakerStop = async () => undefined) {
  const log: string[] = [];
  const { tasks: timers, timers: worker } = manualTimers();
  const blocked = Promise.withResolvers<void>();
  let polls = 0;
  const seat = createBotSeat({
    control: {
      pulse: async () => {
        log.push('receipt');
        return [];
      },
    },
    speaker: {
      wake: () => log.push('wake'),
      stop: async () => {
        log.push('speaker-stop');
        await speakerStop();
      },
    },
    publication: {
      start: () => log.push('publication-start'),
      close: async () => {
        log.push('publication-close');
      },
    },
    feed: withFeed
      ? {
          start: () => log.push('listening-start'),
          poll: async () => {
            polls++;
            await blocked.promise;
          },
          close: async () => {
            log.push('listening-close');
          },
        }
      : null,
    pollMs: 50,
    timers: worker,
    failed: () => log.push('failed'),
  });
  return { seat, log, timers, blocked, polls: () => polls };
}
test('control receipts never wait for speaking work', async () => {
  const { seat, log, timers } = harness(false);
  await seat.pulse();
  assert({
    given: 'a speech seat pulse',
    should: 'wake the speaker and record the receipt without a poll timer',
    actual: [log, timers.size],
    expected: [['publication-start', 'wake', 'receipt'], 0],
  });
  await seat.stop();
  assert({
    given: 'seat shutdown',
    should: 'stop the speaker, then end its publication',
    actual: log.slice(-2),
    expected: ['speaker-stop', 'publication-close'],
  });
});
test("cross-examination's own hearing polls single-flight, joins with the seat and ends after its publication (ISSUE-764)", async () => {
  const { seat, log, timers, blocked, polls } = harness(true);
  const poll = timers.get(50)!;
  const first = poll();
  const overlapping = poll();
  assert({
    given: 'a slow hearing poll and an overlapping 50ms tick',
    should: 'keep one poll in flight',
    actual: polls(),
    expected: 1,
  });
  blocked.resolve();
  await Promise.all([first, overlapping]);
  await seat.stop();
  assert({
    given: 'a completed poll and shutdown',
    should:
      'join the hearing with the publication, wake the speaker after the poll, clear the timer and end the hearing last',
    actual: [log, timers.size],
    expected: [
      [
        'publication-start',
        'listening-start',
        'wake',
        'speaker-stop',
        'publication-close',
        'listening-close',
      ],
      0,
    ],
  });
});
test('a speaker that fails to stop still releases the publication', async () => {
  const { seat, log } = harness(false, async () => {
    throw new Error('stop failed');
  });
  const stopped = await seat.stop().then(
    () => 'stopped',
    () => 'rejected',
  );
  assert({
    given: 'a seat whose speaker stop rejects',
    should: 'end the publication anyway, so no participant is left joined',
    actual: [stopped, log.at(-1)],
    expected: ['rejected', 'publication-close'],
  });
});

test('a seat whose hearing fails to start closes what it started (ISSUE-789)', async () => {
  const log: string[] = [];
  const broken = new Error('listener unavailable');
  const closeFault = new Error('The operation was aborted.');
  const failures: unknown[] = [];
  const feedClosed = Promise.withResolvers<void>();
  let thrown: unknown;
  try {
    createBotSeat({
      control: { pulse: async () => [] },
      speaker: { wake: () => {}, stop: async () => {} },
      publication: {
        start: () => log.push('publication-start'),
        // A plain function that throws, not a rejected promise.
        close: () => {
          log.push('publication-close');
          throw closeFault;
        },
      },
      feed: {
        start: () => {
          throw broken;
        },
        poll: async () => {},
        close: async () => {
          log.push('feed-close');
          feedClosed.resolve();
        },
      },
      pollMs: 50,
      timers: manualTimers().timers,
      failed: (error, stage) => failures.push([error, stage]),
    });
  } catch (error) {
    thrown = error;
  }
  await within(feedClosed.promise, 'The hearing’s close');
  await new Promise((resolve) => setImmediate(resolve));
  assert({
    given: 'a cross-examination seat whose hearing throws as it starts',
    should:
      'rethrow, close its publication and hearing, and report a close that throws',
    actual: { thrown, log, failures },
    expected: {
      thrown: broken,
      log: ['publication-start', 'publication-close', 'feed-close'],
      failures: [[closeFault, 'close']],
    },
  });
});
