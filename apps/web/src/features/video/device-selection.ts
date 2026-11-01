import { z } from 'zod';
import type { DeviceCheckSnapshot } from './device-check-controller';

const selectionSchema = z.strictObject({
  camera: z.string().min(1).max(512).exactOptional(),
  microphone: z.string().min(1).max(512).exactOptional(),
});
type LocalStorage = () => Pick<Storage, 'getItem' | 'setItem'>;
const tabStorage: LocalStorage = () => window.sessionStorage;
/**
 * Tab-local and account-scoped: one actor's devices never read another
 * account's keys, and the tab's own lifetime bounds them (ISSUE-879).
 */
const selectionKey = (roomId: string, actorId: string | null) =>
  `daisy:checked-devices:${roomId}:${actorId ?? 'anonymous'}`;

/** Tab-local continuity across the Room → Round document load; never a server payload. */
export function readCheckedDevices(
  roomId: string,
  storage = tabStorage,
  actorId: string | null = null,
): z.infer<typeof selectionSchema> {
  try {
    const value = JSON.parse(
      storage().getItem(selectionKey(roomId, actorId)) ?? '{}',
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
  actorId: string | null = null,
) {
  const choices = readCheckedDevices(roomId, storage, actorId);
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
  const choices = readCheckedDevices(roomId, storage, actorId);
  for (const kind of kinds) delete choices[kind];
  try {
    storage().setItem(selectionKey(roomId, actorId), JSON.stringify(choices));
  } catch {
    // Storage can be disabled; there is then no choice to forget.
  }
}
