import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDeviceCheckController } from './device-check-controller';
import { readCheckedDevices, rememberCheckedDevices } from './device-selection';

setupRitewayBun();

test('checked device identities cross document navigation only within the local room tab', async () => {
  const values = new Map<string, string>();
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
  const devices = createDeviceCheckController({
    open: async (kind, selected) => ({
      deviceId: selected ?? `${kind}-actual`,
      confirm: async () => undefined,
      onLoss: () => () => undefined,
      stop: () => undefined,
    }),
  });
  devices.subscribe((snapshot) =>
    rememberCheckedDevices('room-a', snapshot, storage),
  );
  devices.select('camera', 'chosen-camera');
  await devices.check('camera');
  await devices.check('microphone');
  devices.dispose('round-transition');
  assert({
    given:
      'passed selected camera and resolved default microphone, followed by document teardown',
    should: 'retain exact checked identities for this room only',
    actual: [
      readCheckedDevices('room-a', storage),
      readCheckedDevices('room-b', storage),
    ],
    expected: [
      { camera: 'chosen-camera', microphone: 'microphone-actual' },
      {},
    ],
  });
});

test('unavailable or invalid browser storage does not expose device data', () => {
  const unavailable = () => {
    throw new Error('Storage denied');
  };
  assert({
    given: 'blocked session storage or a malformed stored choice',
    should: 'return no unchecked identities',
    actual: [
      readCheckedDevices('room-a', unavailable),
      readCheckedDevices('room-a', () => ({
        getItem: () => '{"camera":123}',
        setItem: () => undefined,
      })),
    ],
    expected: [{}, {}],
  });
});
