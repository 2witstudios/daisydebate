import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recordInSegments, sendIfVoiced, type Recording } from './segments';

setupRitewayBun();

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Recordings that log their start and stop, each holding `voicedMs` of voice. */
const recorder = (log: string[], voicedMs = 2_000) => {
  let count = 0;
  return (): Recording => {
    count += 1;
    const name = `segment ${count}`;
    log.push(`record ${name}`);
    return {
      stop: async () => {
        log.push(`stop ${name}`);
        return { blob: new Blob([name]), voicedMs };
      },
    };
  };
};

/** A segment timer the test ends by hand, one segment at a time. */
const handTimer = () => {
  const pending: Array<() => void> = [];
  return {
    wait: (_ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
        signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    endSegment: () => pending.shift()?.(),
  };
};

describe('recordInSegments', () => {
  test('sends each segment as it ends', async () => {
    const log: string[] = [];
    const sent: Recording[] = [];
    const timer = handTimer();
    const control = new AbortController();
    recordInSegments({
      record: recorder(log),
      upload: async (recording) => {
        sent.push(recording);
        await recording.stop();
      },
      segmentMs: 30_000,
      wait: timer.wait,
      signal: control.signal,
    });
    await settle();
    timer.endSegment();
    await settle();
    assert({
      given: 'a speech that runs past one segment',
      should: 'send the first segment and start recording the next',
      actual: { log, sent: sent.length },
      expected: {
        log: ['record segment 1', 'stop segment 1', 'record segment 2'],
        sent: 1,
      },
    });
    control.abort();
  });

  test('finishing early sends the open segment and waits for every upload', async () => {
    const log: string[] = [];
    const timer = handTimer();
    let release: () => void = () => undefined;
    const slowUpload = new Promise<void>((resolve) => (release = resolve));
    const speech = recordInSegments({
      record: recorder(log),
      upload: async (recording) => {
        await recording.stop();
        await slowUpload;
        log.push('uploaded');
      },
      segmentMs: 30_000,
      wait: timer.wait,
      signal: new AbortController().signal,
    });
    await settle();
    let finished = false;
    void speech.finish().then(() => (finished = true));
    await settle();
    const beforeUpload = finished;
    release();
    await speech.done;
    assert({
      given: 'the speaker ending their speech mid-segment',
      should:
        'stop and send the open segment, and finish only once its upload is done',
      actual: { beforeUpload, finished, log },
      expected: {
        beforeUpload: false,
        finished: true,
        log: ['record segment 1', 'stop segment 1', 'uploaded'],
      },
    });
  });

  test('the turn ending flushes the open segment and records no more', async () => {
    const log: string[] = [];
    const timer = handTimer();
    const control = new AbortController();
    const speech = recordInSegments({
      record: recorder(log),
      upload: async (recording) => {
        await recording.stop();
      },
      segmentMs: 30_000,
      wait: timer.wait,
      signal: control.signal,
    });
    await settle();
    control.abort();
    await speech.done;
    assert({
      given: 'the turn ending while a segment is recording',
      should: 'send that segment and start no other',
      actual: log,
      expected: ['record segment 1', 'stop segment 1'],
    });
  });
});

describe('sendIfVoiced', () => {
  test('sends a clip only when someone was speaking in it', async () => {
    const sent: Blob[] = [];
    const send = async (blob: Blob) => {
      sent.push(blob);
    };
    const voiced = await sendIfVoiced(recorder([], 2_000)(), send);
    const silent = await sendIfVoiced(recorder([], 300)(), send);
    assert({
      given: 'a clip with two seconds of voice and one with a cough',
      should: 'send the first and not the second',
      actual: { voiced, silent, sent: sent.length },
      expected: { voiced: true, silent: false, sent: 1 },
    });
  });
});
