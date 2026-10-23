import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPacedAudioWriter } from './paced-publication';
setupRitewayBun();

const SERVER_OFFSET_MS = 1_792_000_000_000 - 1_000;

/** A writer over a stub publication: every window it authorizes, and progress. */
function stubWriter(options: {
  readonly framesPerAuthorization: number;
  readonly refuseWindow?: number;
  readonly segmentEndsAtMs?: number;
}) {
  let now = 1_000;
  let sample = 0;
  const windows: { before: string; after: string }[] = [];
  const captured: number[] = [];
  const accepted: number[] = [];
  const sent: number[] = [];
  const write = createPacedAudioWriter({
    publication: {
      capture10ms: async (frame: Int16Array) => {
        captured.push(frame.length);
        const beforeMs = now;
        now += 1;
        const startSample = sample;
        sample += frame.length;
        return { startSample, endSample: sample, beforeMs, afterMs: now };
      },
      close: async () => undefined,
    } as never,
    sampleRate: 24_000,
    channels: 1,
    nowMs: () => now,
    waitUntilMs: async (due) => {
      now = Math.max(now, due);
    },
    calibrate: async () => ({
      sentAtMs: 999,
      receivedAtMs: 1_000,
      serverNowMs: SERVER_OFFSET_MS + 1_000,
      precisionMs: 1,
    }),
    framesPerAuthorization: options.framesPerAuthorization,
    ...(options.segmentEndsAtMs === undefined
      ? {}
      : { segmentEndsAtMs: options.segmentEndsAtMs }),
    authorizeWindow: async (window) => {
      windows.push(window);
      return windows.length !== options.refuseWindow;
    },
    onAccepted: (eligibleSamples) => {
      accepted.push(eligibleSamples);
    },
    onSent: (sentSamples) => {
      sent.push(sentSamples);
    },
  });
  return { write, windows, captured, accepted, sent };
}
const signal = () => new AbortController().signal;

test('a frame refused after sending still counts as sent, so a resume repeats nothing', async () => {
  const stub = stubWriter({ framesPerAuthorization: 1, refuseWindow: 2 });
  const result = await stub.write(new Int16Array(720), signal());
  assert({
    given: 'a three-frame job whose second window authorization is refused',
    should:
      'credit only the first frame but report both sent frames, then stop',
    actual: {
      captured: stub.captured,
      accepted: stub.accepted,
      sent: stub.sent,
      eligible: result.eligibleSamples,
    },
    expected: {
      captured: [240, 240],
      accepted: [240],
      sent: [240, 480],
      eligible: 240,
    },
  });
});

test('frames are authorized as one union window per ten frames', async () => {
  const stub = stubWriter({ framesPerAuthorization: 10 });
  const result = await stub.write(new Int16Array(240 * 25), signal());
  const spans = stub.windows.map(
    (w) => Date.parse(w.after) - Date.parse(w.before),
  );
  assert({
    given: 'a 25-frame job authorized every 10 frames',
    should:
      'authorize three union windows (10, 10 and the last 5 frames) and credit each batch',
    actual: {
      windows: stub.windows.length,
      wideEnough: spans.slice(0, 2).every((span) => span >= 90),
      accepted: stub.accepted,
      complete: result.complete,
    },
    expected: {
      windows: 3,
      wideEnough: true,
      accepted: [2400, 4800, 6000],
      complete: true,
    },
  });
});

test('a known segment end clamps the union and stops before a batch past it', async () => {
  const endsAt = SERVER_OFFSET_MS + 1_000 + 150;
  const stub = stubWriter({
    framesPerAuthorization: 10,
    segmentEndsAtMs: endsAt,
  });
  const result = await stub.write(new Int16Array(240 * 30), signal());
  assert({
    given:
      'a 30-frame job whose segment ends about 150 ms in, authorized every 10 frames',
    should:
      'clamp the second union to the segment end and send no batch that starts past it',
    actual: {
      windows: stub.windows.length,
      clamped: Date.parse(stub.windows[1]!.after) <= endsAt,
      sentFrames: stub.captured.length,
      complete: result.complete,
    },
    expected: { windows: 2, clamped: true, sentFrames: 20, complete: false },
  });
});
