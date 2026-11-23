import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { DeviceCheckSnapshot } from '../../../features/video/device-check-controller';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { DeviceChoice } from './device-check';

setupRitewayBun();
type Props = Parameters<typeof DeviceChoice>[0];
const check = (
  status: DeviceCheckSnapshot['camera']['status'],
  reason: DeviceCheckSnapshot['camera']['reason'] = null,
  selectedDeviceId: string | null = null,
) => ({ status, generation: 1, selectedDeviceId, deviceId: null, reason });
const snapshot = (
  camera = check('unchecked'),
  microphone = check('unchecked'),
): DeviceCheckSnapshot => ({
  camera,
  microphone,
  devicesPassed: camera.status === 'passed' && microphone.status === 'passed',
});
const devices = {
  preview: () => null,
  select: () => undefined,
} as unknown as Props['devices'];
const input = (kind: MediaDeviceKind, deviceId: string, label: string) =>
  ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo;
const inputs = [
  input('videoinput', 'cam-1', 'Desk camera'),
  input('videoinput', 'cam-2', ''),
  input('audioinput', 'mic-1', 'Headset'),
];
const choice = (kind: Props['kind'], state: DeviceCheckSnapshot) =>
  renderAccessible(
    <DeviceChoice
      kind={kind}
      devices={devices}
      snapshot={state}
      inputs={inputs}
    />,
  );
/** What the device's problem alert says, or null when it says nothing. */
const alert = (view: AccessibleView) =>
  view.has('alert') ? view.text('alert') : null;
const options = (view: AccessibleView) =>
  view.within('combobox').names('option');

test('device choice lists only its own kind with a labelled fallback', () => {
  assert({
    given: 'two cameras, one unlabelled, and one microphone',
    should:
      'offer the default plus each matching input, numbering a blank label',
    actual: [
      options(choice('camera', snapshot())),
      options(choice('microphone', snapshot())),
    ],
    expected: [
      ['System default', 'Desk camera', 'Input 2'],
      ['System default', 'Headset'],
    ],
  });
});

test('device choice says only what failed, and has no Check button', () => {
  const failed = choice(
    'camera',
    snapshot(check('denied', 'permission-denied', 'cam-1')),
  );
  const checking = choice('microphone', snapshot(undefined, check('checking')));
  const passed = choice('camera', snapshot(check('passed')));
  assert({
    given: 'a denied, a checking and a passed device',
    should:
      'name the failure in words beside its selected device, and say nothing while checking or once passed',
    actual: [
      alert(failed)?.includes("Camera: blocked by this site's settings"),
      failed.has('option', 'Desk camera', { selected: true }),
      [failed, checking, passed].some((view) => view.count('button') > 0),
      checking.has('alert'),
      passed.has('alert'),
    ],
    expected: [true, true, false, false, false],
  });
});

test('a refused device check names who blocked it and the remedy', () => {
  const failed = (
    kind: Props['kind'],
    status: DeviceCheckSnapshot['camera']['status'],
    reason: DeviceCheckSnapshot['camera']['reason'],
  ) =>
    choice(
      kind,
      kind === 'camera'
        ? snapshot(check(status, reason))
        : snapshot(undefined, check(status, reason)),
    );
  const system = failed('camera', 'denied', 'system-denied');
  const systemMic = failed('microphone', 'denied', 'system-denied');
  const site = failed('camera', 'denied', 'permission-denied');
  const busy = failed('microphone', 'unavailable', 'device-in-use');
  const missing = failed('camera', 'unavailable', 'device-missing');
  const missingMic = failed('microphone', 'unavailable', 'device-missing');
  const silent = failed('camera', 'unavailable', 'no-signal');
  const silentMic = failed('microphone', 'unavailable', 'no-signal');
  const passed = choice('camera', snapshot(check('passed')));
  assert({
    given:
      'a system denial, a site denial, a busy device, a missing device, a silent opened device and a passed check',
    should:
      'blame the operating system and name its privacy setting, point to site settings and a reload, ask to close the other app, connect a device or use Continuity Camera, say an opened device sent nothing, and say nothing once passed',
    actual: [
      alert(system)?.includes('Camera: blocked by your system'),
      alert(system)?.includes(
        'System Settings › Privacy & Security › Camera and allow your browser',
      ),
      alert(systemMic)?.includes('Privacy & Security › Microphone'),
      alert(site)?.includes("Camera: blocked by this site's settings"),
      alert(site)?.includes(
        "Allow the camera in your browser's site settings, then reload the page.",
      ),
      alert(busy)?.includes('Microphone: in use'),
      alert(busy)?.includes('Close the other app using your microphone'),
      alert(missing)?.includes('Camera: no camera found'),
      alert(missing)?.includes(
        'Connect a camera or use Continuity Camera, then try again.',
      ),
      alert(missingMic)?.includes('Microphone: no microphone found'),
      alert(silent)?.includes('Camera: opened but sent no video'),
      alert(silentMic)?.includes('Microphone: opened but picked up no sound'),
      silent.has('alert'),
      passed.has('alert'),
    ],
    expected: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ],
  });
});
