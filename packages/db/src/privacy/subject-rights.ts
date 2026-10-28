import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RoomClosureTransitions } from '../room-closure-privacy';
import { subjectRightsAdoption } from './adoption';
import type { PrivacySubject } from './contracts';
import {
  runPrivacyErasure,
  runPrivacyExport,
  type PrivacyVerificationBinding,
} from './operations';
import type { PrivacyErasureInput } from './planner';

type Database = Pick<BunSQLDatabase, 'transaction'>;

/** Closes one member's account through every feature's erase step (ADR 0087). */
export const erasePrivacySubject = (
  database: Database,
  input: PrivacyErasureInput,
  rooms: RoomClosureTransitions,
  verificationBindings: readonly PrivacyVerificationBinding[],
) =>
  runPrivacyErasure(
    database,
    input,
    subjectRightsAdoption(rooms),
    verificationBindings,
  );

/** One member's own data from every feature's export step. */
export const exportPrivacySubject = (
  database: Database,
  subject: PrivacySubject,
  rooms: RoomClosureTransitions,
) => runPrivacyExport(database, subject, subjectRightsAdoption(rooms));
