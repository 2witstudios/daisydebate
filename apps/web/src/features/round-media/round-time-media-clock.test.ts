import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTimerQueue } from '../realtime/connection-store.test-support';
import { createRoundTime } from '../round-runtime/round-time';
import { ran } from '../../ui/debate-room/live-round.test-support';
import { settle } from './adapters/livekit-room.test-support';
import { createRoundViewFollower } from './follow-round-view';
import { createMediaController } from './media-harness.test-support';
import {
  admission,
  roundId,
  snapshot,
  transportStub,
} from './media-fixtures.test-support';
import {
  MEDIA_READ_LET_FINISH_MS,
  type MediaReadEvent,
} from './media-read-intent';
import { MEDIA_READ_BUDGET_MS } from './request-media';
import { nextMediaRefreshAt } from './refresh-deadline';
import { roundTimeMediaClock } from './schedule-deadline';
setupRitewayBun();

const view = ran(1);
const deadlineMs = nextMediaRefreshAt(view)!;
const RTT_MS = 200;
const UNCERTAINTY_MS = RTT_MS / 2;

/** A sampled clock reading `lead` before the deadline, its evidence just in. */
const calibrated = (leadMs: number) => {
  const scheduler = createTimerQueue((now, ms) => now + ms);
  const roundTime = createRoundTime({
    monotonicNowMs: scheduler.now,
    hydrationSeedServerMs: deadlineMs - 60_000,
  });
  const sentAtMs = scheduler.now();
  scheduler.advance(RTT_MS);
  roundTime.sample({
    serverNowMs: deadlineMs - leadMs - UNCERTAINTY_MS,
    sentAtMs,
    receivedAtMs: scheduler.now(),
    generation: 1,
  });
  return { scheduler, roundTime };
};

const followed = (leadMs: number) => {
  const { scheduler, roundTime } = calibrated(leadMs);
  const events: MediaReadEvent[] = [];
  const state = { refreshes: 0 };
  const follow = createRoundViewFollower({
    clock: roundTimeMediaClock({ roundTime, scheduler }),
    reconcile: (event) => events.push(event),
    refresh: () => state.refreshes++,
  });
  const boundaries = () =>
    events.filter((event) => event.kind === 'boundary').length;
  return { scheduler, roundTime, follow, boundaries, state };
};

/** The real controller on the sampled clock, with its next reads held forever. */
const heldReads = async (paced: boolean) => {
  const { scheduler, roundTime } = calibrated(5000);
  const signals: AbortSignal[] = [];
  const reply = { held: false };
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: view.version,
    api: {
      admit: async () => admission,
      reconcile: async (_id, signal) => {
        signals.push(signal);
        if (reply.held) await new Promise(() => undefined);
        return snapshot;
      },
    },
    transport: () => transportStub(),
    changed: () => undefined,
    ...(paced
      ? {
          readBudget: {
            now: scheduler.now,
            ms: MEDIA_READ_BUDGET_MS,
            at: (ms: number, fire: () => void) => {
              const timer = scheduler.setTimeout(fire, ms);
              return () => scheduler.clearTimeout(timer);
            },
          },
        }
      : {}),
  });
  await controller.join();
  const follow = createRoundViewFollower({
    clock: roundTimeMediaClock({ roundTime, scheduler }),
    reconcile: (event) => void controller.reconcile(event),
    refresh: () => undefined,
  });
  reply.held = true;
  return { scheduler, controller, follow, signals };
};

test('the follower emits its boundary from the sampled clock, once the lower bound has passed', () => {
  const { scheduler, follow, boundaries, state } = followed(5000);
  const cancel = follow(view);
  scheduler.advance(5000 + UNCERTAINTY_MS - 1);
  assert({
    given: 'the sampled clock reading the deadline with its lower bound short',
    should: 'not emit a boundary a server read could still answer early',
    actual: [boundaries(), state.refreshes],
    expected: [0, 0],
  });
  scheduler.advance(1);
  assert({
    given: 'the lower bound of the sampled clock reaching the deadline',
    should: 'emit one boundary and one refresh',
    actual: [boundaries(), state.refreshes],
    expected: [1, 1],
  });
  cancel();
  follow(view)();
  assert({
    given: 'the same view accepted again after its deadline fired',
    should: 'keep the one fired record: offer again, refresh no more',
    actual: [boundaries(), state.refreshes],
    expected: [2, 1],
  });
});

test('a re-anchor before the deadline moves the armed boundary without a new view', () => {
  const { scheduler, roundTime, follow, boundaries } = followed(30_000);
  follow(view);
  scheduler.advance(1000);
  const sentAtMs = scheduler.now();
  scheduler.advance(RTT_MS);
  roundTime.sample({
    serverNowMs: deadlineMs - 2000 - UNCERTAINTY_MS,
    sentAtMs,
    receivedAtMs: scheduler.now(),
    generation: 2,
  });
  scheduler.advance(2000 + UNCERTAINTY_MS - 1);
  const held = boundaries();
  scheduler.advance(1);
  assert({
    given: 'a calibration moving the server deadline 27 seconds closer',
    should: 'fire at the corrected instant, on the same accepted view',
    actual: [held, boundaries()],
    expected: [0, 1],
  });
});

test('a view accepted while the deadline is inside the uncertainty waits for the lower bound', () => {
  const { scheduler, roundTime, follow, boundaries } = followed(5000);
  scheduler.advance(5000 + UNCERTAINTY_MS - 10);
  const inside = roundTime.nowMs() >= deadlineMs;
  follow(view);
  const before = boundaries();
  scheduler.advance(10);
  assert({
    given: 'a projection past the deadline whose lower bound is not',
    should: 'not call the deadline due until the lower bound passes it',
    actual: [inside, before, boundaries()],
    expected: [true, 0, 1],
  });
});

test('in a burst the boundary lets a young read finish, for at most the let-finish window', async () => {
  const { scheduler, controller, follow, signals } = await heldReads(true);
  const cancel = follow(view);
  await settle();
  const AGE_AT_BOUNDARY_MS = 500;
  scheduler.advance(5000 + UNCERTAINTY_MS - AGE_AT_BOUNDARY_MS);
  cancel();
  follow({ ...view, version: view.version + 1 });
  await settle();
  const young = signals.at(-1)!;
  const started = signals.length;
  scheduler.advance(AGE_AT_BOUNDARY_MS);
  await settle();
  const atBoundary = [young.aborted, signals.length - started];
  scheduler.advance(MEDIA_READ_LET_FINISH_MS - AGE_AT_BOUNDARY_MS - 1);
  await settle();
  const justBefore = [young.aborted, signals.length - started];
  scheduler.advance(1);
  await settle();
  assert({
    given: 'a new view starting a read 500 ms before the boundary',
    should:
      'hold the fresh read until that read is 2 s old, the worst case being 2 s after the boundary',
    actual: [atBoundary, justBefore, young.aborted, signals.length - started],
    expected: [[false, 0], [false, 0], true, 1],
  });
  controller.stop();
});

test('the sampled clock boundary supersedes a held read through the real controller', async () => {
  const { scheduler, controller, follow, signals } = await heldReads(false);
  follow(view);
  await settle();
  const stale = signals.at(-1)!;
  const started = signals.length;
  scheduler.advance(5000 + UNCERTAINTY_MS - 1);
  await settle();
  const heldBefore = [stale.aborted, signals.length - started];
  scheduler.advance(1);
  await settle();
  assert({
    given: 'a read held across the deadline of the sampled clock',
    should: 'abort it and start one fresh read at the boundary, and not before',
    actual: [heldBefore, stale.aborted, signals.length - started],
    expected: [[false, 0], true, 1],
  });
  controller.stop();
});
