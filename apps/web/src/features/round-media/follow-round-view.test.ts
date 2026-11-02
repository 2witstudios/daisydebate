import { assert, setupRitewayBun, test } from 'riteway/bun';
import { followRoundView } from './follow-round-view';
import { createMediaController } from './media-controller';
import { nextMediaRefreshAt } from './refresh-deadline';
import { settle } from './browser-transport.test-support';
import { admission, roundId, snapshot } from './media-controller.test-support';
import { ran } from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();

const view = ran(1);
const deadlineMs = nextMediaRefreshAt(view)!;

const mounted = async () => {
  const state = { reads: 0, refreshes: 0, signals: [] as AbortSignal[] };
  const held = { reply: null as Promise<unknown> | null };
  const controller = createMediaController({
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
    transport: () => ({
      connect: async () => undefined,
      apply: async () => undefined,
      stopTracks: () => undefined,
      disconnect: async () => undefined,
    }),
    changed: () => undefined,
  });
  await controller.join();
  const fires: (() => void)[] = [];
  const delays: number[] = [];
  const follow = (next: typeof view, nowMs: number) =>
    followRoundView({
      view: next,
      nowMs,
      reconcile: (event) => void controller.reconcile(event),
      refresh: () => state.refreshes++,
      schedule: (fire, delayMs) => {
        fires.push(fire);
        delays.push(delayMs);
        return () => undefined;
      },
    });
  return { state, held, controller, fires, delays, follow };
};

test('a due boundary from the caller supersedes the read held at that version', async () => {
  const media = await mounted();
  media.follow(view, deadlineMs - 5_000);
  await settle();
  const reads = media.state.reads;
  media.held.reply = new Promise(() => undefined);
  void media.controller.reconcile({ kind: 'wake' });
  await settle();
  const heldSignal = media.state.signals.at(-1);
  media.held.reply = null;
  media.fires[0]!();
  await settle();
  assert({
    given: 'the deadline timer firing for the accepted view',
    should:
      'refresh, abort the held read and read fresh at the captured version',
    actual: [
      media.delays,
      heldSignal?.aborted,
      media.state.reads - reads,
      media.state.refreshes,
    ],
    expected: [[5_000], true, 2, 1],
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
  media.fires[0]!();
  await settle();
  assert({
    given:
      'a newer view accepted after its deadline, then the zero-delay timer',
    should: 'refresh but not abort the read the view started',
    actual: [
      media.delays,
      media.state.reads - before,
      media.state.refreshes,
      media.state.signals.at(-1)?.aborted,
    ],
    expected: [[0], 1, 1, false],
  });
  media.controller.stop();
});
