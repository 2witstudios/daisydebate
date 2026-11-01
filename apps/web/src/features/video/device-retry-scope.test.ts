import { MemoryStorage } from '../../lib/storage.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retryMissingDevices } from '../round-media/media-status';
import {
  forgetCheckedDevices,
  readCheckedDevices,
  rememberCheckedDevices,
} from './device-selection';

setupRitewayBun();

/** The Room check the actor ran, with the camera now gone from the machine. */
const checkedBoth = {
  camera: { status: 'passed', deviceId: 'gone-camera' },
  microphone: { status: 'passed', deviceId: 'good-microphone' },
} as const;

test('the actual Retry path clears only the missing device for the actor who checked it', () => {
  const storage = new MemoryStorage();
  const host = () => storage;
  rememberCheckedDevices('room-1', checkedBoth as never, host, 'actor-a');
  const before = readCheckedDevices('room-1', host, 'actor-a');
  // The production edge binds the browser tab; the test binds the same
  // host-backed forget the browser session storage provides.
  retryMissingDevices(
    'room-1',
    ['camera'],
    'actor-a',
    (roomId, kinds, _storage, actor) =>
      forgetCheckedDevices(roomId, kinds, host, actor ?? null),
  );
  const after = readCheckedDevices('room-1', host, 'actor-a');
  const otherActor = readCheckedDevices('room-1', host, 'actor-b');
  assert({
    given:
      'actor-a checked a camera that is now missing and a working microphone, then pressed Retry',
    should:
      'drop only that actor’s missing camera so the reconnect captures the default, keep the microphone choice, and never write another principal’s key',
    actual: { before, after, otherActor },
    expected: {
      before: {
        state: 'available',
        choices: { camera: 'gone-camera', microphone: 'good-microphone' },
      },
      after: { state: 'available', choices: { microphone: 'good-microphone' } },
      otherActor: { state: 'available', choices: {} },
    },
  });
});

test('a retry that names no actor forgets nothing silently: the anonymous scope is the only key touched', () => {
  const storage = new MemoryStorage();
  const host = () => storage;
  rememberCheckedDevices('room-1', checkedBoth as never, host, 'actor-a');
  retryMissingDevices('room-1', ['camera']);
  assert({
    given: 'the Retry edge called without a principal (a wiring error)',
    should:
      'leave the signed-in actor’s record untouched rather than half-clearing it',
    actual: readCheckedDevices('room-1', host, 'actor-a'),
    expected: {
      state: 'available',
      choices: { camera: 'gone-camera', microphone: 'good-microphone' },
    },
  });
});
