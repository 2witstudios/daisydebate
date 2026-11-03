import { createDeviceCheckController } from '../video/device-check-controller';
import { rememberCheckedDevices } from '../video/device-selection';

/** Fresh Room check evidence persisted through the production handoff adapter. */
export async function rememberPassedMediaChecks(
  storage: () => Storage,
  roomId: string,
  actorId: string,
) {
  const checks = createDeviceCheckController({
    open: async (kind) => ({
      deviceId: `${kind}-checked`,
      confirm: async () => undefined,
      onLoss: () => () => undefined,
      stop: () => undefined,
    }),
  });
  await checks.check('camera');
  await checks.check('microphone');
  rememberCheckedDevices(roomId, checks.readSnapshot(), storage, actorId);
  checks.dispose('round-transition');
}
