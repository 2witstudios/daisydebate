import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { PrivacySubject } from './privacy/contracts';
import {
  createRoomAccountClosureAdopter,
  type RoomClosureTransitions,
} from './room-account-closure';

/**
 * Runs the Room-closure erasure step for one subject in its own
 * transaction, with the engine's transitions injected, as the privacy
 * operation will.
 */
export const eraseRoomAccountClosure = (
  client: SQL,
  transitions: RoomClosureTransitions,
  subject: PrivacySubject,
  now: string,
) =>
  drizzle({ client }).transaction((tx) =>
    createRoomAccountClosureAdopter(transitions).erase(tx, subject, { now }),
  );
