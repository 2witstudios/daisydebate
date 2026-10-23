import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPacedAudioWriter } from './paced-publication';
setupRitewayBun();

test('a frame refused after sending still counts as sent, so a resume repeats nothing', async () => {
  let now = 1_000;
  let windows = 0;
  const captured: number[] = [];
  const accepted: number[] = [];
  const sent: number[] = [];
  let sample = 0;
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
      serverNowMs: 1_792_000_000_000,
      precisionMs: 1,
    }),
    // The second frame's window is refused.
    authorizeWindow: async () => ++windows !== 2,
    onAccepted: (eligibleSamples) => {
      accepted.push(eligibleSamples);
    },
    onSent: (sentSamples) => {
      sent.push(sentSamples);
    },
  });
  const result = await write(new Int16Array(720), new AbortController().signal);
  assert({
    given: 'a three-frame job whose second window authorization is refused',
    should:
      'credit only the first frame but report both sent frames, then stop',
    actual: { captured, accepted, sent, eligible: result.eligibleSamples },
    expected: {
      captured: [240, 240],
      accepted: [240],
      sent: [240, 480],
      eligible: 240,
    },
  });
});
