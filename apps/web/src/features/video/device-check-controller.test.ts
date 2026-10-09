import { describe, test } from 'bun:test';
import { assert, setupRitewayBun } from 'riteway/bun';
import {
  createDeviceCheckController,
  type DeviceCapture,
  type DeviceLoss,
} from './device-check-controller';
setupRitewayBun();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function capture(deviceId = 'local-device') {
  const confirmation = deferred<void>();
  let loss: ((reason: DeviceLoss) => void) | undefined;
  let stopped = 0;
  const handle: DeviceCapture = {
    deviceId,
    confirm: () => confirmation.promise,
    onLoss(callback) {
      loss = callback;
      return () => {
        loss = undefined;
      };
    },
    stop() {
      stopped += 1;
      loss?.('track-ended');
    },
  };
  return {
    handle,
    confirmation,
    ended: (reason: DeviceLoss) => loss?.(reason),
    stopped: () => stopped,
  };
}
function fixture() {
  const requests: ReturnType<typeof deferred<DeviceCapture>>[] = [];
  const controller = createDeviceCheckController({
    open: () => {
      const request = deferred<DeviceCapture>();
      requests.push(request);
      return request.promise;
    },
  });
  const complete = async (kind: 'camera' | 'microphone') => {
    const running = controller.check(kind);
    const device = capture();
    requests.at(-1)!.resolve(device.handle);
    await Promise.resolve();
    device.confirmation.resolve();
    await running;
    return device;
  };
  return { controller, requests, complete };
}
describe('local device checks', () => {
  test('requires observed camera frames and microphone level independently', async () => {
    const { controller, complete } = fixture();
    assert({
      given: 'no checks',
      should: 'deny local eligibility',
      actual: controller.readSnapshot().devicesPassed,
      expected: false,
    });
    await complete('camera');
    assert({
      given: 'camera only',
      should: 'still block Ready',
      actual: controller.readSnapshot().devicesPassed,
      expected: false,
    });
    await complete('microphone');
    assert({
      given: 'both observations',
      should: 'report eligibility only',
      actual: controller.readSnapshot().devicesPassed,
      expected: true,
    });
    controller.dispose('departure');
  });
  test('selection synchronously invalidates only its device and emits reason', async () => {
    const { controller, complete } = fixture();
    const camera = await complete('camera');
    await complete('microphone');
    const reasons: string[] = [];
    controller.subscribe((_, event) => {
      if (event) reasons.push(event.reason);
    });
    controller.select('camera', 'new-camera');
    assert({
      given: 'selected camera changes',
      should: 'clear passed before returning',
      actual: [
        controller.readSnapshot().camera.status,
        controller.readSnapshot().microphone.status,
        controller.readSnapshot().devicesPassed,
        camera.stopped(),
        reasons,
      ],
      expected: ['unchecked', 'passed', false, 1, ['selection-changed']],
    });
    controller.dispose('departure');
  });
  test('stale permission completion releases its track without changing current state', async () => {
    const { controller, requests } = fixture();
    const old = controller.check('camera');
    controller.select('camera', 'replacement');
    const stale = capture();
    requests[0]!.resolve(stale.handle);
    await old;
    assert({
      given: 'superseded getUserMedia response',
      should: 'stop stale track and retain unchecked selection',
      actual: [
        stale.stopped(),
        controller.readSnapshot().camera.status,
        controller.readSnapshot().camera.selectedDeviceId,
      ],
      expected: [1, 'unchecked', 'replacement'],
    });
    controller.dispose('departure');
  });
  test('stale frame completion cannot overwrite a newer generation', async () => {
    const { controller, requests } = fixture();
    const old = controller.check('camera');
    const stale = capture();
    requests[0]!.resolve(stale.handle);
    await Promise.resolve();
    const current = controller.check('camera');
    const fresh = capture();
    requests[1]!.resolve(fresh.handle);
    await Promise.resolve();
    fresh.confirmation.resolve();
    await current;
    stale.confirmation.resolve();
    await old;
    assert({
      given: 'late old frame',
      should: 'keep newer passed generation',
      actual: [
        controller.readSnapshot().camera.status,
        controller.readSnapshot().camera.generation,
        stale.stopped(),
      ],
      expected: ['passed', 2, 1],
    });
    controller.dispose('departure');
  });
  for (const reason of [
    'track-ended',
    'device-disappeared',
    'permission-denied',
  ] as const) {
    test(`invalidates on ${reason}`, async () => {
      const { controller, complete } = fixture();
      const camera = await complete('camera');
      await complete('microphone');
      camera.ended(reason);
      assert({
        given: reason,
        should: 'block immediately with concrete reason',
        actual: [
          controller.readSnapshot().devicesPassed,
          controller.readSnapshot().camera.reason,
          controller.readSnapshot().camera.status,
        ],
        expected: [
          false,
          reason,
          reason === 'permission-denied' ? 'denied' : 'unavailable',
        ],
      });
      controller.dispose('departure');
    });
  }
  test('denied and unavailable checks can retry', async () => {
    const { controller, requests, complete } = fixture();
    const denied = controller.check('microphone');
    requests[0]!.reject(
      Object.assign(new Error('private error'), { name: 'NotAllowedError' }),
    );
    await denied;
    assert({
      given: 'permission denial',
      should: 'expose safe denied state',
      actual: controller.readSnapshot().microphone.status,
      expected: 'denied',
    });
    await complete('microphone');
    assert({
      given: 'successful retry',
      should: 'pass new generation',
      actual: controller.readSnapshot().microphone.status,
      expected: 'passed',
    });
    controller.dispose('departure');
  });
  test('intentional cleanup and unsubscribing are silent and idempotent', async () => {
    const { controller, complete } = fixture();
    const camera = await complete('camera');
    const mic = await complete('microphone');
    let failures = 0;
    const unsubscribe = controller.subscribe((_, event) => {
      if (event) failures += 1;
    });
    unsubscribe();
    controller.dispose('round-transition');
    controller.dispose('departure');
    assert({
      given: 'deliberate teardown',
      should: 'stop once without device failure',
      actual: [
        camera.stopped(),
        mic.stopped(),
        failures,
        controller.readSnapshot().devicesPassed,
      ],
      expected: [1, 1, 0, false],
    });
  });
  test('dispose during pending request releases later acquisition', async () => {
    const { controller, requests } = fixture();
    const running = controller.check('camera');
    controller.dispose('departure');
    const device = capture();
    requests[0]!.resolve(device.handle);
    await running;
    assert({
      given: 'late permission after departure',
      should: 'release without passing',
      actual: [device.stopped(), controller.readSnapshot().devicesPassed],
      expected: [1, false],
    });
  });
});
