import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { DeviceCheckSnapshot } from '../../../features/video/device-check-controller';
import { CameraPreview, DeviceChoice } from './device-check';

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
const previews: string[] = [];
const devices = {
  preview: (kind: string) => {
    previews.push(kind);
    return null;
  },
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
  renderToStaticMarkup(
    <DeviceChoice
      kind={kind}
      devices={devices}
      snapshot={state}
      inputs={inputs}
      check={() => undefined}
    />,
  );
const options = (html: string) =>
  [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);

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

test('device choice reports its state and offers a retry only when unpassed', () => {
  const failed = choice(
    'camera',
    snapshot(check('denied', 'permission-denied', 'cam-1')),
  );
  const checking = choice('microphone', snapshot(undefined, check('checking')));
  const passed = choice('camera', snapshot(check('passed')));
  assert({
    given: 'a denied, a checking and a passed device',
    should:
      'name the reason in words, disable the retry while checking, and hide it once passed',
    actual: [
      failed.includes('Camera: denied · blocked by this site&#x27;s settings'),
      failed.includes('Check camera'),
      /<option value="cam-1" selected="">/.test(failed),
      checking.includes('Microphone: checking'),
      /<button[^>]*disabled=""[^>]*>Check microphone<\/button>/.test(checking),
      passed.includes('✓ Camera'),
      passed.includes('Check camera'),
    ],
    expected: [true, true, true, true, true, true, false],
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
      system.includes('Camera: denied · blocked by your system'),
      system.includes(
        'System Settings › Privacy &amp; Security › Camera and allow your browser',
      ),
      systemMic.includes('Privacy &amp; Security › Microphone'),
      site.includes('Camera: denied · blocked by this site&#x27;s settings'),
      site.includes(
        'Allow the camera in your browser&#x27;s site settings, then reload the page.',
      ),
      busy.includes('Microphone: unavailable · in use'),
      busy.includes('Close the other app using your microphone'),
      missing.includes('Camera: unavailable · no camera found'),
      missing.includes(
        'Connect a camera or use Continuity Camera, then check again.',
      ),
      missingMic.includes('Microphone: unavailable · no microphone found'),
      silent.includes('Camera: unavailable · opened but sent no video'),
      silentMic.includes(
        'Microphone: unavailable · opened but picked up no sound',
      ),
      silent.includes('role="note"'),
      passed.includes('role="note"'),
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

test('camera preview shows initials until the camera passes', () => {
  previews.length = 0;
  const waiting = renderToStaticMarkup(
    <CameraPreview
      devices={devices}
      snapshot={snapshot()}
      label="Ada Lovelace"
    />,
  );
  const waitingPreviews = [...previews];
  previews.length = 0;
  const live = renderToStaticMarkup(
    <CameraPreview
      devices={devices}
      snapshot={snapshot(check('passed'), check('passed'))}
      label="Ada Lovelace"
    />,
  );
  assert({
    given: 'an unchecked camera and then passed camera and microphone',
    should:
      'hide the video behind initials, then show it and read the microphone preview',
    actual: [
      waiting.includes('class="sr-only"'),
      waiting.includes('>AL</span>'),
      waitingPreviews,
      live.includes('size-full object-cover'),
      live.includes('>AL</span>'),
      previews,
    ],
    expected: [true, true, [], true, false, ['microphone']],
  });
});
