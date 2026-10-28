import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { PrivacySubject } from './privacy/contracts';
import { createRoomClosurePrivacyAdopter } from './room-closure-privacy';

/**
 * Runs the Room-closure erasure step for one subject in its own
 * transaction, with the engine's transitions injected, as the privacy
 * operation will.
 */
export const eraseRoomClosureSubject = (
  client: SQL,
  transitions: Parameters<typeof createRoomClosurePrivacyAdopter>[0],
  subject: PrivacySubject,
  now: string,
) =>
  drizzle({ client }).transaction((tx) =>
    createRoomClosurePrivacyAdopter(transitions).erase(tx, subject, { now }),
  );
