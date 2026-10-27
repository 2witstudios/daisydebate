import { z } from 'zod';
import type { DeviceCheckSnapshot } from './device-check-controller';

const selectionSchema = z.strictObject({
  camera: z.string().min(1).max(512).exactOptional(),
  microphone: z.string().min(1).max(512).exactOptional(),
});
type LocalStorage = () => Pick<Storage, 'getItem' | 'setItem'>;
const tabStorage: LocalStorage = () => window.sessionStorage;
const selectionKey = (roomId: string) => `daisy:checked-devices:${roomId}`;

/** Tab-local continuity across the Room → Round document load; never a server payload. */
export function readCheckedDevices(
  roomId: string,
  storage = tabStorage,
): z.infer<typeof selectionSchema> {
  try {
    const value = JSON.parse(
      storage().getItem(selectionKey(roomId)) ?? '{}',
    ) as unknown;
    const parsed = selectionSchema.safeParse(value);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Preserve successful checks through teardown, but discard an unchecked changed selection. */
export function rememberCheckedDevices(
  roomId: string,
  snapshot: DeviceCheckSnapshot,
  storage = tabStorage,
) {
  const choices = readCheckedDevices(roomId, storage);
  for (const kind of ['camera', 'microphone'] as const) {
    const check = snapshot[kind];
    if (check.status === 'passed' && check.deviceId)
      choices[kind] = check.deviceId;
    else if (check.reason === 'selection-changed') delete choices[kind];
  }
  try {
    storage().setItem(selectionKey(roomId), JSON.stringify(choices));
  } catch {
    // Storage can be disabled; local device checks still run normally.
  }
}
