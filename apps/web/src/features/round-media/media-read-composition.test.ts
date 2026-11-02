import { assert, setupRitewayBun, test } from 'riteway/bun';
import { settle } from './browser-transport.test-support';
import {
  compose,
  REQUEST_DEADLINE_MS,
} from './media-read-composition.test-support';
import { nextMediaRefreshAt } from './refresh-deadline';
import { ran } from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();

for (const mode of ['headers', 'body'] as const) {
  test(`a within-budget ${mode} read is superseded at the boundary and again by a newer view`, async () => {
    const view = ran(1);
    const deadlineMs = nextMediaRefreshAt(view)!;
    const media = await compose(mode);
    const boundary = {
      kind: 'boundary',
      roundViewVersion: 1,
      deadlineMs,
    } as const;
    media.timer.setTimeout(
      () => void media.controller.reconcile(boundary),
      60_000,
    );
    media.timer.advance(59_000);
    const pending = media.controller.reconcile({ kind: 'wake' });
    await settle();
    const stalled = [media.counts.reads, media.heldAborted()];
    media.timer.advance(1_000);
    await settle();
    // The boundary's fresh apply is still running, so only a later ticket announces.
    const atBoundary = [
      media.counts.reads,
      media.heldAborted(),
      media.applied.length,
      media.received.length,
    ];
    media.timer.advance(200);
    await media.controller.reconcile({ kind: 'view', roundViewVersion: 2 });
    const atView = media.counts.reads;
    await media.controller.reconcile(boundary);
    await media.controller.reconcile({ kind: 'view', roundViewVersion: 2 });
    await media.controller.reconcile({ kind: 'view', roundViewVersion: 1 });
    const afterInert = media.counts.reads;
    const wakes = Array.from({ length: 5 }, () =>
      media.controller.reconcile({ kind: 'wake' }),
    );
    await Promise.all(wakes);
    const afterWakes = media.counts.reads;
    media.release();
    await pending;
    await settle();
    const health = [
      media.controller.state(),
      media.counts.admissions,
      media.counts.connects,
      media.counts.stops,
      media.sameCamera(),
    ];
    media.controller.stop();
    media.timer.advance(120_000);
    await settle();
    assert({
      given:
        'the actual adapter, controller and SDK with a read held across a due boundary and a newer view',
      should:
        'abort it at once, read fresh with one active request, keep the same connection and camera, and never apply or announce the old microphone',
      actual: {
        stalled,
        atBoundary,
        atView,
        afterInert,
        afterWakes,
        health,
        maxActive: media.counts.maxActive,
        applied: media.applied,
        received: media.received,
        timers: media.timer.pending(),
        active: media.counts.active,
      },
      expected: {
        stalled: [2, false],
        atBoundary: [3, true, 1, 0],
        atView: 4,
        afterInert: 4,
        afterWakes: 5,
        health: ['live', 1, 1, 0, true],
        maxActive: 1,
        applied: ['camera', 'camera', 'camera'],
        received: ['camera', 'camera'],
        timers: 0,
        active: 0,
      },
    });
  });

  test(`a stalled ${mode} read expires at its one deadline and its retry owns a new one`, async () => {
    const media = await compose(mode, [500]);
    const pending = media.controller.reconcile({ kind: 'wake' });
    await settle();
    media.timer.advance(REQUEST_DEADLINE_MS - 1);
    await settle();
    const before = [media.heldAborted(), media.counts.reads];
    media.timer.advance(1);
    await settle();
    const expired = [media.heldAborted(), media.counts.reads];
    media.timer.advance(500);
    await pending;
    await settle();
    const retried = [
      media.counts.reads,
      media.counts.stops,
      media.sameCamera(),
    ];
    media.release();
    await settle();
    const late = [media.applied, media.received];
    assert({
      given:
        'a read that stalls past its 10 s deadline on a healthy connection',
      should:
        'abort at exactly the deadline, keep the camera live through the existing retry, and leave the late reply inert',
      actual: { before, expired, retried, late, timers: media.timer.pending() },
      expected: {
        before: [false, 2],
        expired: [true, 2],
        retried: [3, 0, true],
        late: [['camera'], ['camera']],
        timers: 0,
      },
    });
    media.controller.stop();
  });

  test(`disposal cancels actual ${mode} and browser SDK ownership`, async () => {
    const media = await compose(mode);
    const pending = media.controller.reconcile({ kind: 'wake' });
    await settle();
    media.controller.stop();
    await pending;
    const stopped = [
      media.heldAborted(),
      media.counts.active,
      media.controller.state(),
      media.cameraEnded(),
    ];
    media.release();
    await settle();
    media.timer.advance(120_000);
    await settle();
    assert({
      given: 'terminal or account mount disposal during a held read',
      should:
        'settle without a deadline or queued work and never apply late media',
      actual: {
        stopped,
        applied: media.applied,
        received: media.received,
        reads: media.counts.reads,
        timers: media.timer.pending(),
      },
      expected: {
        stopped: [true, 0, 'ended', true],
        applied: [],
        received: [],
        reads: 2,
        timers: 0,
      },
    });
  });
}

test('a live connection whose every read stalls ends unavailable after the retries', async () => {
  const media = await compose('headers', [500, 1_000, 2_000]);
  media.stallEveryRead();
  const pending = media.controller.reconcile({ kind: 'wake' });
  await settle();
  for (const waitMs of [10_000, 500, 10_000, 1_000, 10_000, 2_000, 10_000]) {
    media.timer.advance(waitMs);
    await settle();
  }
  await pending;
  assert({
    given: 'four 10 s expiries with no newer view',
    should:
      'keep the plan and main retry policy, leaving recovery to its owner: released, unavailable, no readmission and no timers',
    actual: [
      media.controller.state(),
      media.counts.reads,
      media.counts.stops,
      media.counts.admissions,
      media.timer.pending(),
    ],
    expected: ['unavailable', 5, 1, 1, 0],
  });
});
