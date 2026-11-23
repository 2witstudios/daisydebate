import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createBrowserDeviceChecks } from './browser-device-checks';
setupRitewayBun();

/** The device checks' scheduler on a clock the test owns (ADR 0164). */
const clock = virtualClock();
const testScheduler = {
  after: (run: () => void, ms: number) => {
    const waiting = new AbortController();
    void clock.sleep(ms, waiting.signal).then(() => {
      if (!waiting.signal.aborted) run();
    });
    return () => waiting.abort();
  },
  every: (run: () => void, ms: number) => {
    const waiting = new AbortController();
    const next = (): Promise<void> =>
      clock.sleep(ms, waiting.signal).then(() => {
        if (waiting.signal.aborted) return;
        run();
        return next();
      });
    void next();
    return () => waiting.abort();
  },
  frame: (run: () => void) => testScheduler.after(run, 0),
};

describe('microphone setup cleanup', () => {
  for (const stage of [
    'source',
    'analyser',
    'connect',
    'fft',
    'resume',
  ] as const)
    test(`releases partial resources when ${stage} throws`, async () => {
      const released: string[] = [];
      const failAt = (at: typeof stage) => {
        if (stage === at)
          throw new DOMException('unsupported setup', 'NotSupportedError');
      };
      const track = {
        readyState: 'live',
        getSettings: () => ({ deviceId: 'local' }),
        addEventListener() {},
        removeEventListener() {},
        stop: () => released.push('track'),
      };
      const source = {
        connect: () => failAt('connect'),
        disconnect: () => released.push('source'),
      };
      const analyser = {
        set fftSize(_size: number) {
          failAt('fft');
        },
        get fftSize() {
          return 1024;
        },
        disconnect: () => released.push('analyser'),
      };
      const controller = createBrowserDeviceChecks({
        mediaDevices: {
          getUserMedia: async () => ({
            getAudioTracks: () => [track],
            getTracks: () => [track],
          }),
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaDevices,
        document: {} as Document,
        scheduler: testScheduler,
        createAudioContext: () =>
          ({
            createMediaStreamSource: () => {
              failAt('source');
              return source;
            },
            createAnalyser: () => {
              failAt('analyser');
              return analyser;
            },
            resume: () => {
              failAt('resume');
              return Promise.resolve();
            },
            close: async () => {
              released.push('context');
            },
          }) as unknown as AudioContext,
      });
      await controller.check('microphone');
      const first = [...released];
      await controller.check('microphone');
      const retry = released.slice(first.length);
      const status = controller.readSnapshot().microphone.status;
      controller.dispose('departure');
      const expected = [
        ...(stage === 'source' ? [] : ['source']),
        ...(['source', 'analyser'].includes(stage) ? [] : ['analyser']),
        'context',
        'track',
      ];
      assert({
        given: `a ${stage} setup failure, retry and subsequent departure`,
        should: 'fail closed and release every acquired resource once',
        actual: { status, first, retry, released },
        expected: {
          status: 'unavailable',
          first: expected,
          retry: expected,
          released: [...expected, ...expected],
        },
      });
    });
});
