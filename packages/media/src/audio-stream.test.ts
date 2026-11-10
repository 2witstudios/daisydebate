import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createStreamingAudioWriter } from './audio-stream';

setupRitewayBun();
const FRAME = 240;
/**
 * A fake clock and native queue: the queue plays out in real time from
 * the moment a frame is handed over, and holds what has not played yet.
 */
function harness(options: { readonly leadMs?: number } = {}) {
  let now = 0;
  let playedUntil = 0;
  const handed: number[] = [];
  let cleared = 0;
  const target: {
    capture10ms: (frame: Int16Array) => Promise<void>;
    queuedMs: () => number;
    clearQueue: () => void;
  } = {
    capture10ms: async (frame: Int16Array) => {
      if (frame.length !== FRAME) throw new Error('frame size');
      handed.push(now);
      playedUntil = Math.max(playedUntil, now) + 10;
    },
    queuedMs: () => Math.max(0, playedUntil - now),
    clearQueue: () => {
      cleared += 1;
      playedUntil = now;
    },
  };
  const write = createStreamingAudioWriter({
    target,
    sampleRate: 24000,
    channels: 1,
    nowMs: () => now,
    waitUntilMs: async (due) => {
      now = Math.max(now, due);
    },
    leadMs: options.leadMs ?? 100,
  });
  return {
    write,
    handed,
    target,
    advance: (ms: number) => {
      now += ms;
    },
    cleared: () => cleared,
  };
}
const pcm = (frames: number) => new Int16Array(frames * FRAME);

test('the writer hands frames over on a 10 ms schedule, `leadMs` ahead', async () => {
  const { write, handed } = harness({ leadMs: 50 });
  const result = await write(pcm(20), new AbortController().signal);
  assert({
    given: 'a 200 ms job and a 50 ms lead into an empty queue',
    should: 'hand the first 50 ms over at once and then one frame every 10 ms',
    actual: { result, handed },
    expected: {
      result: {
        sentSamples: 20 * FRAME,
        playedSamples: 20 * FRAME,
        aborted: false,
        cut: false,
      },
      handed: [
        0, 0, 0, 0, 0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
        130, 140,
      ],
    },
  });
});

test('the writer keeps its cadence while a concurrent call stalls 200 ms (ADR 0122)', async () => {
  // Real time: the stall is another promise on the same event loop.
  const stamps: number[] = [];
  const write = createStreamingAudioWriter({
    target: {
      capture10ms: async () => {
        stamps.push(performance.now());
      },
      queuedMs: () => 0,
      clearQueue: () => undefined,
    },
    sampleRate: 24000,
    channels: 1,
    nowMs: () => performance.now(),
    waitUntilMs: async (due) => {
      while (performance.now() < due)
        await Bun.sleep(Math.max(1, due - performance.now()));
    },
    leadMs: 0,
  });
  let stalled = false;
  const stall = Bun.sleep(200).then(() => {
    stalled = true;
  });
  const start = performance.now();
  await write(pcm(30), new AbortController().signal);
  await stall;
  const beforeStallEnded = stamps.filter((at) => at - start < 190).length;
  const gaps = stamps.slice(1).map((at, index) => at - stamps[index]!);
  assert({
    given: 'a 300 ms stream and a concurrent 200 ms stall it never awaits',
    should:
      'send the stall-time frames on time with no gap anywhere near 100 ms',
    actual: {
      stalled,
      onTime: beforeStallEnded >= 15,
      maxGapUnder60: Math.max(...gaps) < 60,
    },
    expected: { stalled: true, onTime: true, maxGapUnder60: true },
  });
});

test('an abort clears the queue and counts only samples that played (AMEND-1)', async () => {
  const run = async (frames: number) => {
    const h = harness({ leadMs: 100 });
    const controller = new AbortController();
    const capture = h.target.capture10ms;
    h.target.capture10ms = async (frame) => {
      await capture(frame);
      if (h.handed.length === frames) controller.abort();
    };
    const result = await h.write(pcm(100), controller.signal);
    return {
      sent: result.sentSamples / FRAME,
      played: result.playedSamples / FRAME,
      aborted: result.aborted,
      cleared: h.cleared(),
      queued: h.target.queuedMs(),
    };
  };
  assert({
    given: 'an abort inside the first 100 ms lead, all of it still queued',
    should: 'clear the queue and count nothing as played',
    actual: await run(5),
    expected: { sent: 5, played: 0, aborted: true, cleared: 1, queued: 0 },
  });
  assert({
    given:
      'an abort after 30 frames, with the lead and the frame just handed still queued',
    should: 'count as played what was sent less what was still queued',
    actual: await run(30),
    expected: { sent: 30, played: 19, aborted: true, cleared: 1, queued: 0 },
  });
});

test('the writer never hands over a frame whose playout ends past its hard stop (AMEND-2)', async () => {
  const { write, handed } = harness({ leadMs: 100 });
  const result = await write(pcm(50), new AbortController().signal, 205);
  assert({
    given: 'a 500 ms job with a hard stop at 205 ms and a 100 ms lead',
    should:
      'hand over only the 20 frames that finish playing by then, and report the cut',
    actual: { result, frames: handed.length },
    expected: {
      result: {
        sentSamples: 20 * FRAME,
        playedSamples: 20 * FRAME,
        aborted: false,
        cut: true,
      },
      frames: 20,
    },
  });
});

test('the hard stop counts audio already queued ahead of the job (AMEND-2)', async () => {
  const { write, handed } = harness({ leadMs: 100 });
  await write(pcm(10), new AbortController().signal);
  // The first job's last 100 ms is still queued when the next one starts.
  const second = await write(pcm(50), new AbortController().signal, 300);
  assert({
    given:
      'a second job starting behind 100 ms of queued audio, stop at 300 ms',
    should: 'schedule after the queue and stop where playout would pass 300 ms',
    actual: { cut: second.cut, frames: handed.length - 10 },
    expected: { cut: true, frames: 20 },
  });
});

test('a failed handoff stops the stream and still reports what played', async () => {
  const h = harness({ leadMs: 100 });
  const capture = h.target.capture10ms;
  const failure = new Error('handoff');
  h.target.capture10ms = async (frame) => {
    if (h.handed.length === 12) throw failure;
    await capture(frame);
  };
  const result = await h.write(pcm(50), new AbortController().signal);
  assert({
    given: 'a native handoff that fails at the 13th frame',
    should:
      'stop, clear the queue and report the failure with the played prefix',
    actual: {
      sent: result.sentSamples / FRAME,
      played: result.playedSamples / FRAME,
      failure: result.failure,
      cleared: h.cleared(),
    },
    expected: { sent: 12, played: 2, failure, cleared: 1 },
  });
});

test('the writer refuses PCM that is not whole 10 ms frames', async () => {
  const { write } = harness();
  await assertRejects({
    given: 'a partial frame',
    should: 'refuse before any handoff',
    actual: () =>
      write(new Int16Array(FRAME + 1), new AbortController().signal),
    code: 'VALIDATION',
  });
});
