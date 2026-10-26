import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotSeat } from './seat';
import { manualTimers } from './worker-timers.test-support';
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
          poll: async () => {
            polls++;
            await blocked.promise;
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
test('cross-examination polls activity single-flight and stops its timer', async () => {
  const { seat, log, timers, blocked, polls } = harness(true);
  const poll = timers.get(50)!;
  const first = poll();
  const overlapping = poll();
  assert({
    given: 'a slow relay read and an overlapping 50ms tick',
    should: 'keep one poll in flight',
    actual: polls(),
    expected: 1,
  });
  blocked.resolve();
  await Promise.all([first, overlapping]);
  await seat.stop();
  assert({
    given: 'a completed poll and shutdown',
    should: 'wake the speaker after the poll and clear the timer',
    actual: [log, timers.size],
    expected: [
      ['publication-start', 'wake', 'speaker-stop', 'publication-close'],
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
