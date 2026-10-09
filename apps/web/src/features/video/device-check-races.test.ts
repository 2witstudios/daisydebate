import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDeviceCheckController } from './device-check-controller';
setupRitewayBun();
describe('subscriber and synchronous edge races', () => {
  test('synchronous acquisition loss cannot leak a resource or run confirmation', async () => {
    let stopped = 0;
    let confirmed = 0;
    const controller = createDeviceCheckController({
      open: async () => ({
        deviceId: 'local',
        confirm: async () => {
          confirmed += 1;
        },
        onLoss: (callback) => {
          callback('permission-denied');
          return () => {};
        },
        stop: () => {
          stopped += 1;
        },
      }),
    });
    await controller.check('camera');
    controller.dispose('departure');
    assert({
      given: 'loss while registering observer',
      should: 'release once without confirming',
      actual: [stopped, confirmed],
      expected: [1, 0],
    });
  });
  test('subscriber can retry after invalidation without aborting the new check', async () => {
    let aborted = false;
    const controller = createDeviceCheckController({
      open: async () => ({
        deviceId: 'local',
        confirm: async (signal) => {
          aborted = signal.aborted;
        },
        onLoss: () => () => {},
        stop: () => {},
      }),
    });
    controller.subscribe((_, event) => {
      if (event?.reason === 'selection-changed')
        void controller.check('camera');
    });
    controller.select('camera', 'other');
    await Promise.resolve();
    await Promise.resolve();
    assert({
      given: 'synchronous consumer retry',
      should: 'keep new generation acquisition active',
      actual: [aborted, controller.readSnapshot().camera.status],
      expected: [false, 'passed'],
    });
    controller.dispose('departure');
  });
});
