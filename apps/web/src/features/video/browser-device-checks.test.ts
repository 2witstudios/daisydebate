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
      should: 'fail closed locally',
      actual: [
        controller.readSnapshot().camera.status,
        controller.readSnapshot().microphone.status,
      ],
      expected: ['unavailable', 'unchecked'],
    });
    controller.dispose('departure');
  });
});
