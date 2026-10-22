import { assertRejects } from '@daisy/errors/testing';
import { assert } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { AudioStream } from '@livekit/rtc-node';
import { CaptureFrameProcessor } from '../src/capture-frame-processor';
import { createCaptureSubscription } from '../src/native-capture';
import { createMediaService } from '../src/service';
import { config, withNativePublication } from './native-room.test-support';
import { createCaptureClock } from '../src/capture-clock';
import type { withHistoricalSeat } from './native-fixtures.test-support';
import { waitForCadence, pcmJob } from './native-fixtures.test-support';

const openCaptureProbe = async (
  roomName: string,
  identity: string,
  callbacks: Pick<
    Parameters<typeof createCaptureSubscription>[0],
    'onFrame' | 'onTrackClosed'
  >,
) => {
  const service = createMediaService({ config });
  const capture = await createCaptureSubscription({
    url: 'ws://127.0.0.1:7880',
    token: await service.joinToken({
      room: roomName,
      identity: createId(),
      publish: [],
      subscribe: true,
      capture: true,
    }),
    identities: [identity],
    nowMs: () => performance.now(),
    ...callbacks,
  });
  return { service, capture };
};

export const proveNativeCapture: Parameters<
  typeof withNativePublication
>[0] = async ({ publisher, roomName, identity, track }) => {
  const receipts: {
    identity: string;
    trackId: string;
    pcm: Int16Array;
    beforeMs: number;
    afterMs: number;
    sequence: number;
  }[] = [];
  const first = Promise.withResolvers<void>(),
    closed = Promise.withResolvers<void>();
  const { capture } = await openCaptureProbe(roomName, identity, {
    onFrame: (frame) => {
      receipts.push(frame);
      if (receipts.length >= 3) first.resolve();
    },
    onTrackClosed: () => closed.resolve(),
  });
  const beforeDrain: number[] = [];
  const undrained = new AudioStream(track, {
    sampleRate: 16000,
    numChannels: 1,
    frameSizeMs: 10,
    noiseCancellation: new CaptureFrameProcessor({
      identity,
      trackId: 'actual-sdk-probe',
      nowMs: () => performance.now(),
      onFrame: (frame) => beforeDrain.push(frame.beforeMs),
      onFault: () => {
        throw new Error('Native probe frame rejected');
      },
    }),
  });
  try {
    const signal = AbortSignal.timeout(5000);
    const receiving = Promise.race([
      first.promise,
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new Error('No native capture callback')),
          { once: true },
        ),
      ),
    ]);
    const anchor = performance.now();
    for (let i = 0; i < 60; i++) {
      await waitForCadence(anchor + (i + 1) * 10, signal);
      await publisher.capture10ms(pcmJob().subarray(0, 480));
    }
    await receiving;
    const drainingAt = performance.now();
    const stampsBeforeReading = beforeDrain.slice();
    const queued = undrained.getReader();
    try {
      const frame = await queued.read();
      assert({
        given: 'real native frames queued without any reader',
        should: 'stamp in synchronous processor callbacks before later drain',
        actual: {
          callbacks: stampsBeforeReading.length >= 3,
          preDrain: stampsBeforeReading.every((at) => at <= drainingAt),
          samples: frame.value?.samplesPerChannel,
        },
        expected: { callbacks: true, preDrain: true, samples: 160 },
      });
    } finally {
      await queued.cancel();
      queued.releaseLock();
    }

    assert({
      given: 'actual microphone publication over local LiveKit',
      should:
        'receive native callback brackets with copied 16k mono10ms frames',
      actual: {
        frames: receipts.length >= 3,
        scope: receipts.every(
          (f) =>
            f.identity === identity &&
            f.trackId.length > 0 &&
            f.pcm.length === 160 &&
            f.beforeMs <= f.afterMs &&
            Number.isFinite(f.beforeMs),
        ),
        nonzero: receipts.some((f) => f.pcm.some((v) => v !== 0)),
        sequence: receipts.every((f, i) => f.sequence === i),
      },
      expected: {
        frames: true,
        scope: true,
        nonzero: true,
        sequence: true,
      },
    });
    await publisher.close();
    await Promise.race([
      closed.promise,
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new Error('Native capture stream did not close')),
          { once: true },
        ),
      ),
    ]);
  } finally {
    await capture.close();
  }
};

export const proveCaptureRoomDeletion: Parameters<
  typeof withNativePublication
>[0] = async ({ publisher, roomName, identity }) => {
  const received = Promise.withResolvers<void>();
  let closedTracks = 0;
  const { service, capture } = await openCaptureProbe(roomName, identity, {
    onFrame: () => received.resolve(),
    onTrackClosed: () => {
      closedTracks++;
    },
  });
  try {
    const signal = AbortSignal.timeout(5000),
      anchor = performance.now();
    for (let i = 0; i < 40; i++) {
      await waitForCadence(anchor + (i + 1) * 10, signal);
      await publisher.capture10ms(pcmJob().subarray(0, 480));
    }
    await Promise.race([
      received.promise,
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new Error('Capture did not receive PCM')),
          { once: true },
        ),
      ),
    ]);
    await service.deleteRoom(roomName);
    const reason = await Promise.race([
      capture.closed,
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new Error('Capture did not leave deleted room')),
          { once: true },
        ),
      ),
    ]);
    assert({
      given: 'the actual LiveKit room deleted during capture',
      should: 'disconnect the worker and close the observed microphone stream',
      actual: [reason, closedTracks],
      expected: ['disconnected', 1],
    });
    await assertRejects({
      given: 'a disconnected subscription',
      should: 'refuse scanning stale native track handles',
      code: 'CONFLICT',
      actual: () => capture.setIdentities([identity]),
    });
  } finally {
    await capture.close();
  }
};

/** Real callback observation cadence; this never claims acoustic/network origin. */
export async function proveCalibratedCapture(
  history: Parameters<Parameters<typeof withHistoricalSeat>[1]>[0],
) {
  const clock = createCaptureClock(await history.calibrate());
  const retained: {
    beforeMs: number;
    afterMs: number;
    pcm: Int16Array;
    sequence: number;
  }[] = [];
  let dropped = 0;
  await withNativePublication(async ({ publisher, roomName, identity }) => {
    const { capture } = await openCaptureProbe(roomName, identity, {
      onFrame(frame) {
        const window = clock.observe(frame);
        if (window)
          retained.push({
            ...window,
            pcm: frame.pcm,
            sequence: frame.sequence,
          });
        else dropped++;
      },
      onTrackClosed: () => undefined,
    });
    try {
      const signal = AbortSignal.timeout(10000),
        anchor = performance.now();
      for (let i = 0; i < 200; i++) {
        if (i === 100) clock.refresh(await history.calibrate());
        await waitForCadence(anchor + (i + 1) * 10, signal);
        await publisher.capture10ms(pcmJob().subarray(0, 480));
      }
      await publisher.close();
    } finally {
      await capture.close();
    }
  }, history.binding);
  let authorized = 0;
  for (const frame of retained) {
    if (
      await history.authorizeWindow({
        before: new Date(Math.floor(frame.beforeMs)).toISOString(),
        after: new Date(Math.ceil(frame.afterMs)).toISOString(),
      })
    )
      authorized++;
  }
  assert({
    given:
      'real 16k native callbacks, real PG calibration refresh and full historical-window reads',
    should:
      'retain genuine PCM after cadence bootstrap with outward eligible observation brackets',
    actual: {
      retained: retained.length >= 10,
      nonzero: retained.some((f) => f.pcm.some((v) => v !== 0)),
      allAuthorized: authorized === retained.length,
      gaps: dropped > 0,
    },
    expected: {
      retained: true,
      nonzero: true,
      allAuthorized: true,
      gaps: true,
    },
  });
}
