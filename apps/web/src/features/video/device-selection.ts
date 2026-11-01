import { z } from 'zod';
import type { DeviceCheckSnapshot } from './device-check-controller';

const selectionSchema = z.strictObject({
  camera: z.string().min(1).max(512).exactOptional(),
  microphone: z.string().min(1).max(512).exactOptional(),
});
type LocalStorage = () => Pick<Storage, 'getItem' | 'setItem'>;
const tabStorage: LocalStorage = () => window.sessionStorage;
const selectionKey = (roomId: string, actorId: string | null) =>
  `daisy:checked-devices:${roomId}:${actorId ?? 'anonymous'}`;
export type CheckedDeviceRead =
  | {
      readonly state: 'available';
      readonly choices: z.infer<typeof selectionSchema>;
    }
  | {
      readonly state: 'unavailable';
      readonly reason: 'unreadable' | 'invalid';
    };

/** One typed result distinguishes absent preferences from failed reads. */
export function readCheckedDevices(
  roomId: string,
  storage = tabStorage,
  actorId: string | null = null,
): CheckedDeviceRead {
  let raw: string | null;
  try {
    raw = storage().getItem(selectionKey(roomId, actorId));
  } catch {
    return { state: 'unavailable', reason: 'unreadable' };
  }
  if (raw === null) return { state: 'available', choices: {} };
  try {
    const parsed = selectionSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { state: 'available', choices: parsed.data }
      : { state: 'unavailable', reason: 'invalid' };
  } catch {
    return { state: 'unavailable', reason: 'invalid' };
  }
}

/** Best-effort Room handoff records actual passed checks; it cannot authorize default capture on a failed read. */
export function rememberCheckedDevices(
  roomId: string,
  snapshot: DeviceCheckSnapshot,
  storage = tabStorage,
  actorId: string | null = null,
) {
  const read = readCheckedDevices(roomId, storage, actorId);
  if (
    read.state === 'unavailable' &&
    !(['camera', 'microphone'] as const).some(
      (kind) => snapshot[kind].status === 'passed' && snapshot[kind].deviceId,
    )
  )
    return;
  const choices: z.infer<typeof selectionSchema> =
    read.state === 'available' ? { ...read.choices } : {};
  for (const kind of ['camera', 'microphone'] as const) {
    const check = snapshot[kind];
    if (check.status === 'passed' && check.deviceId)
      choices[kind] = check.deviceId;
    else if (check.reason === 'selection-changed') delete choices[kind];
  }
  try {
    storage().setItem(selectionKey(roomId, actorId), JSON.stringify(choices));
  } catch {
    // Storage can be disabled; local device checks still run normally.
  }
}

/** After a checked device went missing, an explicit retry uses the browser default for that kind only. */
export function forgetCheckedDevices(
  roomId: string,
  kinds: readonly ('camera' | 'microphone')[],
  storage = tabStorage,
  actorId: string | null = null,
) {
  const read = readCheckedDevices(roomId, storage, actorId);
  if (read.state === 'unavailable') return false;
  const choices = { ...read.choices };
  for (const kind of kinds) delete choices[kind];
  try {
    storage().setItem(selectionKey(roomId, actorId), JSON.stringify(choices));
    return true;
  } catch {
    return false;
  }
}

/** Round/account lifecycle cleanup removes the record, not only its device values. */
export function clearCheckedDevices(
  roomId: string,
  storage: () => Pick<Storage, 'removeItem'> = () => window.sessionStorage,
  actorId: string | null = null,
): void {
  try {
    storage().removeItem(selectionKey(roomId, actorId));
  } catch {
    // Disabled storage has no recoverable device choice.
  }
}
