import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createStreamingAudioWriter } from './audio-stream';

setupRitewayBun();
const frameSamples = 240;
// Normalized from the retained wait due70.011209/resume149.646792 trace.
const lateByMs = 79.635583;
const observedGapMs = 86.025459;
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
const sequence = (length: number) =>
  Array.from({ length }, (_, index) => index);
const job = (frames: number) =>
  Int16Array.from({ length: frames * frameSamples }, (_, sample) =>
    Math.floor(sample / frameSamples),
  );

/** A FIFO that actually drains on clock advance; capacity is not reserve. */
function replay(input: {
  readonly leadMs: number;
  readonly lateDueMs?: number;
  readonly lateCaptureFrame?: number;
  readonly onWake?: () => void;
}) {
  let now = 0;
  let queuedUntil = 0;
  let started = false;
  let cleared = 0;
  const underruns: { from: number; to: number }[] = [];
  const frames: { index: number; at: number; end: number; reserve: number }[] =
    [];
  const waits: {
    due: number;
    entry: number;
    returned: number;
    reserve: number;
  }[] = [];
  const reserve = () => Math.max(0, queuedUntil - now);
  const advanceTo = (next: number) => {
    if (next < now) throw new Error('clock cannot run backward');
    if (started && next > queuedUntil)
      underruns.push({
        from: rounded(Math.max(now, queuedUntil)),
        to: rounded(next),
      });
    now = next;
  };
  const target = {
    capture10ms: async (frame: Int16Array) => {
      const index = frame[0]!;
      const end = Math.max(now, queuedUntil) + 10;
      queuedUntil = end;
      started = true;
      frames.push({
        index,
        at: rounded(now),
        end: rounded(end),
        reserve: rounded(reserve()),
      });
      if (reserve() > 500)
        throw new Error('modeled native queue capacity exceeded');
      // A pending native capture continuation lets the existing queue play.
      if (index === input.lateCaptureFrame) advanceTo(now + observedGapMs);
    },
    queuedMs: reserve,
    clearQueue: () => {
      cleared += 1;
      queuedUntil = now;
      started = false;
    },
  };
  const write = createStreamingAudioWriter({
    target,
    sampleRate: 24000,
    channels: 1,
    nowMs: () => now,
    leadMs: input.leadMs,
    waitUntilMs: async (due) => {
      const entry = now;
      advanceTo(due + (due === input.lateDueMs ? lateByMs : 0));
      waits.push({
        due,
        entry: rounded(entry),
        returned: rounded(now),
        reserve: rounded(reserve()),
      });
      input.onWake?.();
    },
  });
  return {
    write,
    frames,
    waits,
    underruns,
    queuedMs: reserve,
    cleared: () => cleared,
    // Drain exactly the tail, excluding idle time after the speech.
    drain: () => advanceTo(queuedUntil),
  };
}

async function withUnresolvedAuthority(
  work: (settled: () => boolean) => Promise<void>,
) {
  let settled = false;
  const authority = Promise.withResolvers<void>();
  const pending = authority.promise.then(() => {
    settled = true;
  });
  try {
    await work(() => settled);
  } finally {
    authority.resolve();
    await pending;
  }
}

describe('streaming audio writer under delayed scheduling', () => {
  test('late initial pacing wake reports underrun and catches up without authority', async () => {
    await withUnresolvedAuthority(async (settled) => {
      const h = replay({ leadMs: 0, lateDueMs: 70 });
      const result = await h.write(job(30), new AbortController().signal);
      const beforeDrain = rounded(h.queuedMs());
      h.drain();
      assert({
        given:
          'a lead0 initial stream whose70ms pacing wait resumes79.635583ms late while authority is unresolved',
        should:
          'retain absolute deadlines, immediately hand over all overdue frames in order and expose the modeled underrun',
        actual: {
          result,
          order: h.frames.map(({ index }) => index),
          waits: h.waits.map(({ due }) => due),
          lateWake: h.waits[6],
          catchup: h.frames.slice(7, 15).map(({ at }) => at),
          underruns: h.underruns,
          beforeDrain,
          afterDrain: h.queuedMs(),
          authoritySettled: settled(),
        },
        expected: {
          result: {
            sentSamples: 7200,
            playedSamples: 7200,
            aborted: false,
            cut: false,
          },
          order: sequence(30),
          waits: [
            ...sequence(7).map((index) => (index + 1) * 10),
            ...sequence(15).map((index) => 150 + index * 10),
          ],
          lateWake: { due: 70, entry: 60, returned: 149.635583, reserve: 0 },
          catchup: Array(8).fill(149.635583),
          underruns: [{ from: 70, to: 149.635583 }],
          beforeDrain: 89.635583,
          afterDrain: 0,
          authoritySettled: false,
        },
      });
    });
  });

  test('a delay during300ms initial fill is distinct from established reserve', async () => {
    await withUnresolvedAuthority(async (settled) => {
      const h = replay({ leadMs: 300, lateCaptureFrame: 6 });
      const result = await h.write(job(100), new AbortController().signal);
      h.drain();
      assert({
        given:
          'a one-second job delayed86.025459ms after its seventh capture during initial fill',
        should:
          'expose16.025459ms of modeled underrun, refill immediately and retain its original absolute schedule',
        actual: {
          sent: result.sentSamples,
          order: h.frames.map(({ index }) => index),
          catchup: h.frames.slice(7, 39).map(({ at }) => at),
          nextWait: h.waits[0],
          underruns: h.underruns,
          afterDrain: h.queuedMs(),
          authoritySettled: settled(),
        },
        expected: {
          sent: 24000,
          order: sequence(100),
          catchup: Array(32).fill(86.025459),
          nextWait: {
            due: 90,
            entry: 86.025459,
            returned: 90,
            reserve: 316.025459,
          },
          underruns: [{ from: 70, to: 86.025459 }],
          afterDrain: 0,
          authoritySettled: false,
        },
      });
    });
  });

  test('established300ms lead absorbs the same late pacing wake', async () => {
    await withUnresolvedAuthority(async (settled) => {
      const h = replay({ leadMs: 300, lateDueMs: 70 });
      const result = await h.write(job(100), new AbortController().signal);
      const tail = rounded(h.queuedMs());
      h.drain();
      assert({
        given:
          'a one-second job with established300ms lead and a70ms pacing wait79.635583ms late',
        should:
          'keep continuous modeled playout, catch up overdue frames immediately and never shift later deadlines or await authority',
        actual: {
          sent: result.sentSamples,
          order: h.frames.map(({ index }) => index),
          lateWake: h.waits[6],
          catchup: h.frames.slice(37, 45).map(({ at }) => at),
          waits: h.waits.map(({ due }) => due),
          underruns: h.underruns,
          tail,
          afterDrain: h.queuedMs(),
          authoritySettled: settled(),
        },
        expected: {
          sent: 24000,
          order: sequence(100),
          lateWake: {
            due: 70,
            entry: 60,
            returned: 149.635583,
            reserve: 220.364417,
          },
          catchup: Array(8).fill(149.635583),
          waits: [
            ...sequence(7).map((index) => (index + 1) * 10),
            ...sequence(55).map((index) => 150 + index * 10),
          ],
          underruns: [],
          tail: 310,
          afterDrain: 0,
          authoritySettled: false,
        },
      });
    });
  });

  test('abort at a late wake clears reserve before another capture', async () => {
    const controller = new AbortController();
    const h = replay({
      leadMs: 300,
      lateDueMs: 10,
      onWake: () => controller.abort(),
    });
    const result = await h.write(job(100), controller.signal);
    h.drain();
    assert({
      given:
        'abort while the first pacing wait resumes79.635583ms late with audio still queued',
      should:
        'clear immediately, count only wholly played frames and accept no later frame',
      actual: {
        result,
        frames: h.frames.length,
        cleared: h.cleared(),
        queued: h.queuedMs(),
      },
      expected: {
        result: {
          sentSamples: 7440,
          playedSamples: 1920,
          aborted: true,
          cut: false,
        },
        frames: 31,
        cleared: 1,
        queued: 0,
      },
    });
  });

  test('late wake cannot enqueue a frame beyond hard stop after underrun', async () => {
    const h = replay({ leadMs: 0, lateDueMs: 70 });
    const result = await h.write(job(100), new AbortController().signal, 160);
    h.drain();
    assert({
      given:
        'a late wake at149.635583ms after queue drain and a160ms hard stop',
      should:
        'accept only one overdue frame ending159.635583ms and cut before the next',
      actual: {
        result,
        order: h.frames.map(({ index }) => index),
        last: h.frames.at(-1),
        queued: h.queuedMs(),
      },
      expected: {
        result: {
          sentSamples: 1920,
          playedSamples: 1920,
          aborted: false,
          cut: true,
        },
        order: sequence(8),
        last: { index: 7, at: 149.635583, end: 159.635583, reserve: 10 },
        queued: 0,
      },
    });
  });
});
