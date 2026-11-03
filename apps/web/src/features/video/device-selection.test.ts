import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDeviceCheckController } from './device-check-controller';
import {
  forgetCheckedDevices,
  readCheckedDevices,
  rememberCheckedDevices,
} from './device-selection';

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
      {
        state: 'available',
        choices: { camera: 'chosen-camera', microphone: 'microphone-actual' },
      },
      { state: 'available', choices: {} },
    ],
  });
  forgetCheckedDevices('room-a', ['camera'], storage);
  assert({
    given: 'a retry after only the checked camera went missing',
    should: 'forget that choice alone, keeping the working checked microphone',
    actual: readCheckedDevices('room-a', storage),
    expected: {
      state: 'available',
      choices: { microphone: 'microphone-actual' },
    },
  });
});

test('unavailable or invalid browser storage does not expose device data', () => {
  const unavailable = () => {
    throw new Error('Storage denied');
  };
  assert({
    given: 'blocked session storage or a malformed stored choice',
    should:
      'retain an explicit preference failure without returning unchecked default identities',
    actual: [
      readCheckedDevices('room-a', unavailable),
      readCheckedDevices('room-a', () => ({
        getItem: () => '{"camera":123}',
        setItem: () => undefined,
      })),
    ],
    expected: [
      { state: 'unavailable', reason: 'unreadable' },
      { state: 'unavailable', reason: 'invalid' },
    ],
  });
});

test('unreadable choices and failed forget remain distinct from an absent saved preference', () => {
  const blocked = () => ({
    getItem: () => {
      throw new Error('private storage fault');
    },
    setItem: () => undefined,
  });
  const failedWrite = () => ({
    getItem: () => '{"camera":"checked"}',
    setItem: () => {
      throw new Error('private write fault');
    },
  });
  assert({
    given:
      'an absent key, unreadable storage, invalid data and a failed explicit forget',
    should:
      'preserve typed read failure and refuse to claim successful persistence',
    actual: [
      readCheckedDevices('room', () => ({
        getItem: () => null,
        setItem: () => undefined,
      })),
      readCheckedDevices('room', blocked),
      readCheckedDevices('room', () => ({
        getItem: () => '{"camera":42}',
        setItem: () => undefined,
      })),
      forgetCheckedDevices('room', ['camera'], failedWrite),
    ],
    expected: [
      { state: 'available', choices: {} },
      { state: 'unavailable', reason: 'unreadable' },
      { state: 'unavailable', reason: 'invalid' },
      false,
    ],
  });
});

test('best-effort Room handoff replaces unreadable data only with an actual passed check', async () => {
  let value = '{"camera":42}';
  const storage = () => ({
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  const checks = createDeviceCheckController({
    open: async (kind) => ({
      deviceId: `${kind}-actual`,
      confirm: async () => undefined,
      onLoss: () => () => undefined,
      stop: () => undefined,
    }),
  });
  rememberCheckedDevices('room', checks.readSnapshot(), storage);
  const beforeCheck = value;
  await checks.check('camera');
  rememberCheckedDevices('room', checks.readSnapshot(), storage);
  assert({
    given:
      'invalid stored choices before and after an actual successful camera check',
    should:
      'retain failed-read evidence until fresh checked evidence can replace it',
    actual: [beforeCheck, readCheckedDevices('room', storage)],
    expected: [
      '{"camera":42}',
      { state: 'available', choices: { camera: 'camera-actual' } },
    ],
  });
  checks.dispose('departure');
});
