import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { PrivacySubject } from './privacy/contracts';
import {
  createRoomAccountClosureAdopter,
  type RoomClosureTransitions,
} from './room-account-closure';
import { inTransaction } from './tx';

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
  inTransaction(drizzle({ client }), (tx) =>
    createRoomAccountClosureAdopter(transitions).erase(tx, subject, { now }),
  );

/** Runs the same step's export for one subject, in its own transaction. */
export const exportRoomAccountClosure = (
  client: SQL,
  transitions: RoomClosureTransitions,
  subject: PrivacySubject,
) =>
  inTransaction(drizzle({ client }), (tx) =>
    createRoomAccountClosureAdopter(transitions).export(tx, subject),
  );
