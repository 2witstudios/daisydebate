import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaHarness } from './media-harness.test-support';
import {
  admission,
  roundId,
  snapshot,
  transportStub,
} from './media-fixtures.test-support';
import { createRoundViewFollower } from './follow-round-view';
import { nextMediaRefreshAt } from './refresh-deadline';
import { settle } from './adapters/livekit-room.test-support';
import { ran } from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();

const view = ran(1);
const deadlineMs = nextMediaRefreshAt(view, 0)!;

const mounted = async () => {
  const state = { reads: 0, refreshes: 0, signals: [] as AbortSignal[] };
  const held = { reply: null as Promise<unknown> | null };
  const controller = createMediaHarness({
    roundId,
    initialRoundViewVersion: view.version,
    api: {
      admit: async () => admission,
      reconcile: async (_id, signal) => {
        state.reads++;
        state.signals.push(signal);
        return (await held.reply) ?? snapshot;
      },
    },
    transport: () => transportStub(),
    changed: () => undefined,
  });
  await controller.join();
  const armed = new Map<number, () => void>();
  const deadlines: number[] = [];
  let armedId = 0;
  let nowMs = 0;
  const follower = createRoundViewFollower({
    clock: {
      now: () => nowMs,
      at: (at, fire) => {
        const id = ++armedId;
        armed.set(id, fire);
        deadlines.push(at);
        return () => armed.delete(id);
      },
    },
    reconcile: (event) => void controller.reconcile(event),
    refresh: () => state.refreshes++,
  });
  let cancel = () => undefined as unknown;
  /** Each accepted view reruns the effect, cancelling the previous arm first. */
  const follow = (next: typeof view, at: number) => {
    cancel();
    nowMs = at;
    cancel = follower(next);
  };
  const fire = () => {
    for (const [id, armedFire] of armed) {
      armed.delete(id);
      armedFire();
    }
  };
  return { state, held, controller, armed, deadlines, fire, follow };
};

/** Starts a read that never answers; the reads after it answer at once. */
const holdRead = async (media: Awaited<ReturnType<typeof mounted>>) => {
  media.held.reply = new Promise(() => undefined);
  void media.controller.reconcile({ kind: 'wake' });
  await settle();
  media.held.reply = null;
  return media.state.signals.at(-1);
};

test('a due boundary from the caller supersedes the read held at that version', async () => {
  const media = await mounted();
  media.follow(view, deadlineMs - 5_000);
  await settle();
  const reads = media.state.reads;
  const heldSignal = await holdRead(media);
  media.fire();
  await settle();
  assert({
    given: 'the deadline timer firing for the accepted view',
    should:
      'refresh, abort the held read and read fresh at the captured version',
    actual: [
      media.deadlines,
      heldSignal?.aborted,
      media.state.reads - reads,
      media.state.refreshes,
    ],
    expected: [[deadlineMs], true, 2, 1],
  });
  media.controller.stop();
});

test('a refresh at the same version reads again without aborting', async () => {
  const media = await mounted();
  media.follow(view, deadlineMs - 5_000);
  await settle();
  const before = media.state.reads;
  const signal = media.state.signals.at(-1);
  media.follow({ ...view }, deadlineMs + 1);
  await settle();
  assert({
    given: 'an early boundary read followed by a same-version refreshed view',
    should: 'read once more so the early reply is corrected',
    actual: [media.state.reads - before, signal?.aborted],
    expected: [1, false],
  });
  media.controller.stop();
});

test('a newer view whose deadline already passed costs one read', async () => {
  const media = await mounted();
  await settle();
  const before = media.state.reads;
  media.follow({ ...view, version: view.version + 1 }, deadlineMs + 1);
  await settle();
  media.fire();
  await settle();
  assert({
    given:
      'a newer view accepted after its deadline, then the zero-delay timer',
    should: 'refresh but not abort the read the view started',
    actual: [
      media.deadlines,
      media.state.reads - before,
      media.state.refreshes,
      media.state.signals.at(-1)?.aborted,
    ],
    expected: [[deadlineMs], 1, 1, false],
  });
  media.controller.stop();
});

test('a newer view from the caller supersedes the read it finds held', async () => {
  const media = await mounted();
  const heldSignal = await holdRead(media);
  const before = media.state.reads;
  media.follow({ ...view, version: view.version + 1 }, deadlineMs - 5_000);
  await settle();
  assert({
    given: 'an accepted newer view while a read is held',
    should: 'abort that read and read fresh once',
    actual: [heldSignal?.aborted, media.state.reads - before],
    expected: [true, 1],
  });
  media.controller.stop();
});

test('a same-version view arriving after the deadline still supersedes a held read', async () => {
  const media = await mounted();
  media.follow(view, deadlineMs - 5_000);
  await settle();
  const heldSignal = await holdRead(media);
  const before = media.state.reads;
  media.follow({ ...view }, deadlineMs + 1);
  await settle();
  assert({
    given: 'a poll landing after the deadline, before the old timer ran',
    should:
      'offer the boundary so the held read is replaced, not queued behind',
    actual: [heldSignal?.aborted, media.state.reads - before],
    expected: [true, 1],
  });
  media.controller.stop();
});

test('an overdue deadline refreshes once however many views repeat it', async () => {
  const media = await mounted();
  for (let i = 1; i <= 4; i++) {
    media.follow({ ...view }, deadlineMs + i);
    await settle();
  }
  media.fire();
  await settle();
  const armedBefore = media.deadlines.length;
  media.follow({ ...view }, deadlineMs + 10);
  await settle();
  assert({
    given: 'views cancelling the pending refresh, which then runs once',
    should: 'still refresh once, and arm nothing further for that deadline',
    actual: [
      media.state.refreshes,
      media.deadlines.length - armedBefore,
      media.armed.size,
    ],
    expected: [1, 0, 0],
  });
  media.controller.stop();
});
