import { MemoryStorage } from '../../lib/storage.test-support';
import { createDeviceCheckController } from '../video/device-check-controller';
import {
  rememberCheckedDevices,
  readCheckedDevices,
} from '../video/device-selection';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clearMutePreference,
  clearRoundMediaPreferences,
  departedInSession,
  markDeparture,
  mediaPreferenceKey,
  readMutePreference,
  writeMutePreference,
} from './media-preferences';

setupRitewayBun();

const host = () => ({ session: new MemoryStorage() });

test('mute preference is scoped to one principal in one Round and never aliases another', () => {
  const scope = host();
  writeMutePreference('actor-a', 'round-1', true, scope);
  assert({
    given:
      'actor-a muted round-1, then read under a different principal and a different Round',
    should:
      'keep that choice alone in its key and answer null for every other scope',
    actual: [
      readMutePreference('actor-a', 'round-1', scope),
      readMutePreference('actor-b', 'round-1', scope),
      readMutePreference('actor-a', 'round-2', scope),
    ],
    expected: [true, null, null],
  });
});

test("a tab-scoped preference is only this browser session's: a record placed through the same host is what is read", () => {
  const scope = host();
  writeMutePreference('actor-a', 'round-1', true, scope);
  assert({
    given: 'the same host holding one unmuted replacement',
    should: 'report a later record, keeping the record at one per scope',
    actual: [
      readMutePreference('actor-a', 'round-1', scope),
      readMutePreference('actor-a', 'round-2', scope),
      (() => {
        writeMutePreference('actor-a', 'round-1', false, scope);
        return readMutePreference('actor-a', 'round-1', scope);
      })(),
    ],
    expected: [true, null, false],
  });
});

test('clearing a Round lifecycle ends only that principal-Round record', () => {
  const scope = host();
  writeMutePreference('actor-a', 'round-1', true, scope);
  writeMutePreference('actor-a', 'round-2', true, scope);
  writeMutePreference('actor-b', 'round-2', true, scope);
  clearMutePreference('actor-a', 'round-2', scope);
  assert({
    given: 'three scoped mutes with one cleared by principal and Round',
    should: 'drop exactly that record and keep the other two readable',
    actual: [
      readMutePreference('actor-a', 'round-1', scope),
      readMutePreference('actor-a', 'round-2', scope),
      readMutePreference('actor-b', 'round-2', scope),
    ],
    expected: [true, null, true],
  });
});

test('departure is session-scoped per principal and Round, never carried by other scopes', () => {
  const scope = host();
  assert({
    given:
      'no departure record, then departure recorded for actor-a in round-1',
    should:
      'answer no before, yes after, and no for a different Round or principal',
    actual: [
      departedInSession('actor-a', 'round-1', scope),
      (() => {
        markDeparture('actor-a', 'round-1', scope);
        return departedInSession('actor-a', 'round-1', scope);
      })(),
      departedInSession('actor-a', 'round-2', scope),
      departedInSession('actor-b', 'round-1', scope),
    ],
    expected: [false, true, false, false],
  });
});

test('scoped keys never alias between accounts within the same Round', () => {
  assert({
    given: 'mute and departure keys for two principals in one Round',
    should: 'be distinct strings under the Round, each naming its kind',
    actual: [
      mediaPreferenceKey('mute', 'actor-a', 'round-1'),
      mediaPreferenceKey('mute', 'actor-b', 'round-1'),
      mediaPreferenceKey('left', 'actor-a', 'round-1'),
    ],
    expected: [
      'daisy:mute:media:actor-a:round-1',
      'daisy:mute:media:actor-b:round-1',
      'daisy:left:media:actor-a:round-1',
    ],
  });
});

test('Round departure cleanup removes only its actor’s actual checked-device and mute records', async () => {
  const scope = host();
  const devices = createDeviceCheckController({
    open: async (kind) => ({
      deviceId: `${kind}-actual`,
      confirm: async () => undefined,
      onLoss: () => () => undefined,
      stop: () => undefined,
    }),
  });
  await devices.check('camera');
  await devices.check('microphone');
  rememberCheckedDevices(
    'room-a',
    devices.readSnapshot(),
    () => scope.session,
    'actor-a',
  );
  rememberCheckedDevices(
    'room-a',
    devices.readSnapshot(),
    () => scope.session,
    'actor-b',
  );
  writeMutePreference('actor-a', 'round-a', true, scope);
  writeMutePreference('actor-b', 'round-a', false, scope);
  clearRoundMediaPreferences('actor-a', 'room-a', 'round-a', scope);
  assert({
    given:
      'real successful device checks and mute choices for two actors, followed by actor-a’s confirmed departure/terminal cleanup',
    should:
      'delete exactly the ended actor/Round records and preserve the other principal',
    actual: [
      readCheckedDevices('room-a', () => scope.session, 'actor-a'),
      readCheckedDevices('room-a', () => scope.session, 'actor-b'),
      readMutePreference('actor-a', 'round-a', scope),
      readMutePreference('actor-b', 'round-a', scope),
      scope.session.getItem('daisy:checked-devices:room-a:actor-a'),
    ],
    expected: [
      { state: 'available', choices: {} },
      {
        state: 'available',
        choices: { camera: 'camera-actual', microphone: 'microphone-actual' },
      },
      null,
      false,
      null,
    ],
  });
  devices.dispose('departure');
});
