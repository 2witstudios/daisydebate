import type { DeviceCheckSnapshot } from '../../src/features/video/device-check-controller';
import { createBrowserDeviceChecks } from '../../src/features/video/browser-device-checks';

export const deviceCheckHarnessEntry = new URL(import.meta.url).pathname;

function mount() {
  const controller = createBrowserDeviceChecks();
  const output = document.querySelector('output')!;
  controller.subscribe((snapshot: DeviceCheckSnapshot) => {
    output.textContent = JSON.stringify({
      camera: snapshot.camera.status,
      microphone: snapshot.microphone.status,
      devicesPassed: snapshot.devicesPassed,
      cameraReason: snapshot.camera.reason,
    });
  });
  for (const kind of ['camera', 'microphone'] as const)
    document.querySelector(`#${kind}`)!.addEventListener('click', () => {
      void controller.check(kind);
    });
  document
    .querySelector('#select')!
    .addEventListener('click', () =>
      controller.select('camera', 'nonexistent-local-device'),
    );
  document.querySelector('#stop')!.addEventListener('click', () => {
    controller
      .preview('camera')
      ?.getTracks()
      .forEach((track) => track.stop());
  });
  document.querySelector('#mute')!.addEventListener('click', () => {
    controller
      .preview('microphone')!
      .getTracks()
      .forEach((track) => {
        track.enabled = false;
      });
  });
  document
    .querySelector('#dispose')!
    .addEventListener('click', () => controller.dispose('round-transition'));
}
if (typeof window !== 'undefined') mount();
