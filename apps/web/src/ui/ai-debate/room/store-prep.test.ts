import { assert, setupRitewayBun, test } from 'riteway/bun';
import { AiDebateRequestError } from './api';
import {
  T0,
  fakeApi,
  handClock,
  handTimers,
  roomFixture,
  settle,
} from './room.test-support';
import { createRoomStore } from './store';

setupRitewayBun();

for (const personSide of ['affirmative', 'negative'] as const) {
  for (const remaining of [0, 1]) {
    test(`${personSide} countdown requests prep only with ${remaining}ms remaining`, async () => {
      const log: string[] = [];
      const time = handClock();
      const timers = handTimers();
      const base = fakeApi({ log, at: time.at, personSide });
      const view = await base.view('d1');
      const sequence = view.rules.segments.findIndex(
        (segment) => segment.type === 'speech' && segment.side === personSide,
      );
      const elapsed = view.rules.segments
        .slice(0, sequence)
        .reduce(
          (ms, segment) => ms + segment.durationMs + view.rules.countdownMs,
          0,
        );
      const rules = view.rules.inRoundPrep!;
      const snapshot = {
        ...view,
        startedAt: T0 - elapsed,
        checkpoint: {
          ...view.checkpoint,
          prep_consumed_ms: {
            affirmative: 0,
            negative: 0,
            [personSide]: rules.budgetMsPerSide - remaining,
          },
        },
      };
      const store = createRoomStore({
        id: 'd1',
        clock: time.clock,
        every: timers.every,
        api: {
          ...base,
          view: async () => snapshot,
          command: async (...input) => {
            await base.command(...input);
            if (remaining === 0)
              throw new AiDebateRequestError(422, 'INVARIANT');
          },
        },
      });
      const stop = store.start();
      await settle();
      timers.fire();
      await settle();
      assert({
        given: `a ${personSide} speech countdown with ${remaining}ms prep left`,
        should:
          'request prep only when spendable budget remains and show no failure',
        actual: [
          log.filter((entry) => entry === 'command:startPrep').length,
          store.getSnapshot().problem,
        ],
        expected: [remaining > 0 ? 1 : 0, ''],
      });
      stop();
    });
  }
}

for (const failureStatus of [409, 500]) {
  test(`automatic prep retries after a ${failureStatus} rejection`, async () => {
    const { time, timers, base, view } = await roomFixture();
    const versions: number[] = [];
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const store = createRoomStore({
      id: 'd1',
      clock: time.clock,
      every: timers.every,
      api: {
        ...base,
        view: async () => ({
          ...view,
          startedAt: T0,
          version: 7 + versions.length,
        }),
        command: async (_id, version) => {
          versions.push(version);
          if (versions.length === 1) {
            await pending;
            throw new AiDebateRequestError(failureStatus, 'COMMAND');
          }
        },
      },
    });
    const stop = store.start();
    await settle();
    timers.fire();
    timers.fire();
    assert({
      given: 'an automatic prep request still in flight',
      should: 'keep subsequent ticks from sending duplicate requests',
      actual: versions,
      expected: [7],
    });
    release();
    await settle();
    timers.fire();
    await settle();
    timers.fire();
    await settle();
    assert({
      given: `automatic prep rejected with ${failureStatus} while budget remains`,
      should:
        'retry with the refreshed version and stop retrying after success',
      actual: versions,
      expected: [7, 8],
    });
    stop();
  });
}
