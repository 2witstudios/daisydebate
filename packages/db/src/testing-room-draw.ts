import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { PrivacySubject } from './privacy/contracts';
import { createRoomDrawPrivacyAdopter } from './room-draw-privacy';

/**
 * Runs the room-draw erasure for one subject in its own transaction, with
 * the engine's transitions injected, as the privacy operation will.
 */
export const eraseRoomDrawSubject = (
  client: SQL,
  transitions: Parameters<typeof createRoomDrawPrivacyAdopter>[0],
  subject: PrivacySubject,
  now: string,
) =>
  drizzle({ client }).transaction((tx) =>
    createRoomDrawPrivacyAdopter(transitions).erase(tx, subject, { now }),
  );
