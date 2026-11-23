import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { DeviceCheckSnapshot } from '../features/video/device-check-controller';
import { renderMarkup } from '../test-support/rendered/markup';
import { CameraPreview } from '../ui/rooms/room-page/device-check';

setupRitewayBun();
type Props = Parameters<typeof CameraPreview>[0];
const check = (status: DeviceCheckSnapshot['camera']['status']) => ({
  status,
  generation: 1,
  selectedDeviceId: null,
  deviceId: null,
  reason: null,
});
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

// Markup contract: whether the video shows is carried only by its classes
// (sr-only, then size-full object-cover), and the initials beside it are
// aria-hidden, so neither is in the accessibility tree to assert.
test('camera preview shows initials until the camera passes', () => {
  previews.length = 0;
  const waiting = renderMarkup(
    <CameraPreview
      devices={devices}
      snapshot={snapshot()}
      label="Ada Lovelace"
    />,
  );
  const waitingPreviews = [...previews];
  previews.length = 0;
  const live = renderMarkup(
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
