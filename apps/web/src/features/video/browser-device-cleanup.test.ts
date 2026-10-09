import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createBrowserDeviceChecks } from './browser-device-checks';
setupRitewayBun();

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
      const status = controller.readSnapshot().microphone.status;
      controller.dispose('departure');
      assert({
        given: `a ${stage} setup failure and subsequent departure`,
        should: 'fail closed and release every acquired resource once',
        actual: { status, released },
        expected: {
          status: 'unavailable',
          released: [
            ...(stage === 'source' ? [] : ['source']),
            ...(['source', 'analyser'].includes(stage) ? [] : ['analyser']),
            'context',
            'track',
          ],
        },
      });
    });
});
