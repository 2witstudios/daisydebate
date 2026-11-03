import { VideoPresets } from 'livekit-client';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { cameraResolution } from './camera-resolution';

setupRitewayBun();

test('540p only on a Broadcast, and only with the cores for it', () => {
  const { h360, h540 } = VideoPresets;
  assert({
    given: 'a Broadcast with cores, too few, an unknown count; then none',
    should: 'capture 540p only in the first',
    actual: [
      cameraResolution('captured', 8),
      cameraResolution('captured', 3),
      cameraResolution('captured', undefined),
      cameraResolution('standard', 16),
    ],
    expected: [
      h540.resolution,
      h360.resolution,
      h360.resolution,
      h360.resolution,
    ],
  });
});

test('540p is wide enough for the SDK to keep all three layers', () => {
  assert({
    given: 'the SDK keeps its middle layer only from 960 wide',
    should: 'capture at exactly that, so 360p survives under 540p',
    actual: VideoPresets.h540.resolution.width >= 960,
    expected: true,
  });
});
