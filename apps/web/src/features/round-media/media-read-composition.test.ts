import { assert, setupRitewayBun, test } from 'riteway/bun';
import { settle } from './browser-transport.test-support';
import { compose } from './media-read-composition.test-support';
import {
  MEDIA_REQUEST_DEADLINE_MS,
  MEDIA_RETRY_DELAYS_MS,
} from './request-media';
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
    media.timer.advance(MEDIA_REQUEST_DEADLINE_MS - 1);
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

const stallThroughEveryAttempt = async (
  media: Awaited<ReturnType<typeof compose>>,
) => {
  for (const pauseMs of [...MEDIA_RETRY_DELAYS_MS, 0]) {
    media.timer.advance(MEDIA_REQUEST_DEADLINE_MS);
    await settle();
    media.timer.advance(pauseMs);
    await settle();
  }
};

test('a live connection whose reads all stall keeps its tracks and recovers on the next read', async () => {
  const media = await compose('headers', MEDIA_RETRY_DELAYS_MS);
  media.stallEveryRead();
  const pending = media.controller.reconcile({ kind: 'wake' });
  await settle();
  await stallThroughEveryAttempt(media);
  await pending;
  const stalled = [
    media.controller.state(),
    media.counts.reads,
    media.counts.stops,
    media.counts.connects,
    media.sameCamera(),
    media.timer.pending(),
  ];
  const secondStall = media.controller.reconcile({
    kind: 'view',
    roundViewVersion: 2,
  });
  await settle();
  const duringView = media.controller.state();
  await stallThroughEveryAttempt(media);
  await secondStall;
  media.recoverReads();
  await media.controller.reconcile({ kind: 'wake' });
  await settle();
  assert({
    given:
      'four production-length stalls, a newer view that also stalls, then a read that answers',
    should:
      'keep the same transport and camera, stay out of date through the view, and go live again without readmission',
    actual: {
      stalled,
      duringView,
      recovered: [
        media.controller.state(),
        media.counts.stops,
        media.counts.connects,
        media.counts.admissions,
        media.sameCamera(),
      ],
    },
    expected: {
      stalled: ['out-of-date', 5, 0, 1, true, 0],
      duringView: 'out-of-date',
      recovered: ['live', 0, 1, 1, true],
    },
  });
  media.controller.stop();
});
