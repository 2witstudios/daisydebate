import type { createRoomHandlers } from './handlers';

/** Explicit policy injection; proof choices do not silently activate production. */
export type RoomPolicy = {
  readonly consentTtlMs: number;
  /** How long an open Room may go without a command before maintenance closes it; absent leaves expiry inert (ADR 0070). */
  readonly idleTimeoutMs?: number;
  readonly maxBodyBytes: number;
  readonly limits: Parameters<typeof createRoomHandlers>[0]['limits'];
};
