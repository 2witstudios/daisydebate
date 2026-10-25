import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createBrowserDeviceChecks } from './browser-device-checks';
setupRitewayBun();

describe('browser media boundary', () => {
  test('requests only selected input and exposes denial without raw error', async () => {
    const requests: MediaStreamConstraints[] = [];
    const controller = createBrowserDeviceChecks({
      mediaDevices: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          requests.push(constraints);
          throw new DOMException('private detail', 'NotAllowedError');
        },
      } as unknown as MediaDevices,
      document: {} as Document,
      createAudioContext: () => {
        throw new Error('must not open audio after denial');
      },
    });
    controller.select('camera', 'camera-local-only');
    await controller.check('camera');
    await controller.check('microphone');
    assert({
      given: 'camera selection and default mic',
      should: 'request only the checked input, no transport',
      actual: requests,
      expected: [
        { video: { deviceId: { exact: 'camera-local-only' } }, audio: false },
        { audio: true, video: false },
      ],
    });
    assert({
      given: 'denied permissions',
      should: 'expose denied reason and never pass',
      actual: [
        controller.readSnapshot().camera.status,
        controller.readSnapshot().microphone.status,
        controller.readSnapshot().devicesPassed,
      ],
      expected: ['denied', 'denied', false],
    });
    controller.dispose('departure');
  });
  test('missing device is unavailable independently of the other check', async () => {
    const controller = createBrowserDeviceChecks({
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException('private detail', 'NotFoundError');
        },
      } as unknown as MediaDevices,
      document: {} as Document,
      createAudioContext: () => {
        throw new Error('unreachable');
      },
    });
    await controller.check('camera');
    assert({
      given: 'absent input',
      should: 'fail closed locally and say the device is missing',
      actual: [
        controller.readSnapshot().camera.status,
        controller.readSnapshot().camera.reason,
        controller.readSnapshot().microphone.status,
      ],
      expected: ['unavailable', 'device-missing', 'unchecked'],
    });
    controller.dispose('departure');
  });
  test('a camera that opens but sends no frame has its own reason', async () => {
    let stopped = 0;
    const track = {
      readyState: 'live',
      getSettings: () => ({ deviceId: 'camera-local-only' }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      stop: () => {
        stopped += 1;
      },
    };
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    };
    const controller = createBrowserDeviceChecks({
      mediaDevices: {
        getUserMedia: async () => stream,
        enumerateDevices: async () => [],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      } as unknown as MediaDevices,
      document: {
        createElement: () => ({
          play: async () => undefined,
          requestVideoFrameCallback: () => 1,
          cancelVideoFrameCallback: () => undefined,
          pause: () => undefined,
        }),
      } as unknown as Document,
      createAudioContext: () => {
        throw new Error('unreachable');
      },
      checkTimeoutMs: 0,
    });
    await controller.check('camera');
    assert({
      given: 'an opened camera whose frame never arrives within the bound',
      should:
        'report no signal, distinct from missing or in use, and stop the track',
      actual: [
        controller.readSnapshot().camera.status,
        controller.readSnapshot().camera.reason,
        stopped,
      ],
      expected: ['unavailable', 'no-signal', 1],
    });
    controller.dispose('departure');
  });
});
